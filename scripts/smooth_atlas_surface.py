"""Offline bounded Taubin smoothing; topology and anatomical registration stay fixed."""
import numpy as np


def smooth_surface(positions, triangles):
    original = np.asarray(positions, dtype=np.float64)
    faces = np.asarray(triangles, dtype=np.int64)
    edges = np.unique(np.sort(np.concatenate([
        faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]],
    ]), axis=1), axis=0)
    src = np.concatenate([edges[:, 0], edges[:, 1]])
    dst = np.concatenate([edges[:, 1], edges[:, 0]])
    degree = np.bincount(src, minlength=len(original))[:, None]

    def laplacian(p):
        total = np.column_stack([
            np.bincount(src, weights=p[dst, axis], minlength=len(p))
            for axis in range(3)
        ])
        return total / np.maximum(degree, 1) - p

    def volume(p):
        a, b, c = p[faces[:, 0]], p[faces[:, 1]], p[faces[:, 2]]
        return abs(np.einsum('ij,ij->i', a, np.cross(b, c)).sum() / 6)

    def face_normals(p):
        a, b, c = p[faces[:, 0]], p[faces[:, 1]], p[faces[:, 2]]
        return np.cross(b - a, c - a)

    result = original.copy()
    for _ in range(12):
        # Reverse pass counteracts the shrinkage of ordinary Laplacian smoothing.
        result += .45 * laplacian(result)
        result -= .47 * laplacian(result)
        delta = result - original
        length = np.linalg.norm(delta, axis=1)
        result = original + delta * np.minimum(1, .001 / np.maximum(length, 1e-12))[:, None]

    before = face_normals(original)
    # Very slender source triangles need a smaller local step. Backtrack only
    # their vertices, so fingers and tightly folded contours cannot flip.
    limited = set()
    for _ in range(40):
        inverted = np.einsum('ij,ij->i', before, face_normals(result)) <= 0
        if not np.any(inverted):
            break
        affected = np.unique(faces[inverted])
        limited.update(affected.tolist())
        result[affected] = (result[affected] + original[affected]) * .5
    after = face_normals(result)
    volume_change = volume(result) / volume(original) - 1
    assert np.all(np.einsum('ij,ij->i', before, after) > 0), 'Smoothing inverted a face'
    assert abs(volume_change) < .005, volume_change
    metrics = {
        'method': '12 bounded Taubin pairs, lambda 0.45 / mu -0.47',
        'maxDisplacementMm': float(np.linalg.norm(result - original, axis=1).max() * 1000),
        'volumeChangePercent': float(volume_change * 100),
        'locallyLimitedVertices': len(limited),
        'laplacianRmsRatio': float(np.linalg.norm(laplacian(result)) / np.linalg.norm(laplacian(original))),
    }
    print('Surface smoothing:', metrics, flush=True)
    return result, metrics
