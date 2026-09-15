# 03. Hand/Wrist Anatomy and 3D Modeling

## Modeling scope

The hand and distal forearm share the whole-body atlas and coordinate frame. The wrist asset contains 29 bones, 52 muscle/tendon/fascia structures, 23 vascular structures and 22 neural structures. Named mesh counts are not a claim that every microstructure is present. Patient-specific dimensions and material properties require registration and measurement.

## Structures and relationships

Separate radius/ulna, carpal and metacarpal bones, phalanges, flexor/extensor tendons, muscles, fascia/retinacula, radial/ulnar arteries and palmar connections, superficial/deep veins, median/ulnar/radial nerves, epidermis, dermis and subcutaneous tissue.

The carpal tunnel contains flexor tendons and the median nerve. FCR has a separate fibro-osseous passage; the radial artery must not be placed in the center of the carpal tunnel. Guyon's canal for the ulnar nerve/artery is separate. Model extensor and flexor retinacula and tendon sheaths distinctly. [Wrist ultrasound anatomy](https://pubs.rsna.org/doi/10.1148/rg.256055028), [nerve landmarks](https://pubs.rsna.org/doi/10.1148/rg.2016150088).

The distal radial artery passes near FCR and brachioradialis, turns radially/dorsally toward palmar connections, and is not globally represented by the patch's straight longitudinal axis. Branching and anatomical variants require separate scenarios. [Forearm vascular compartments](https://pubmed.ncbi.nlm.nih.gov/34866700/), [radial variants](https://pubmed.ncbi.nlm.nih.gov/23197145/).

## Reference dimensions and uncertainty

| Quantity | Reference or current setting | Interpretation |
| --- | --- | --- |
| Radial diameter | 2015 study: 195 anesthesia patients, wrist extended 30°; approximately 2.2±0.4 mm | Supports representative radius 1.1 mm; distinguish lumen/wall dimensions and cardiac phase |
| Artery depth | Site, posture, probe pressure and population dependent | Atlas directional separation is not ultrasound-normal depth |
| Fat thickness | UI 0.5–6 mm; default 2.2 mm | Sensitivity range, not a measured population or participant value |
| Coordinate units | Meters in atlas; mm for sensor controls | Preserve explicit conversion |

Sources: [2015 radial ultrasound](https://pubmed.ncbi.nlm.nih.gov/26013978/), [2021 pilot study](https://www.sciencedirect.com/science/article/pii/S0940960221000893). Do not independently sample diameter, depth, sex, height and BMI from arbitrary Gaussian distributions; retain population context and conditional relationships.

## Data sources

| Source | Use | Limitations |
| --- | --- | --- |
| Current atlas | Consistent full-body/hand geometry | Reference individual, not patient registration |
| Digital human forearm/hand, 2018 | Same-specimen CT/MRI/dissection | One adult specimen; not population-representative |
| PIANO/NIMBLE | Candidate MRI/model extension | Separate data/model terms and registration review |
| OpenHands | Candidate statistical finger-bone models | Does not supply all soft tissues |
| Future ultrasound | Sensor-site artery/tendon/skin/compression relationships | No patient-specific dataset is currently included |

[2018 study](https://pmc.ncbi.nlm.nih.gov/articles/PMC6183001/), [PIANO](https://github.com/reyuwei/PIANO_mri_data), [OpenHands](https://github.com/abel-research/OpenHands). These candidate datasets were not automatically merged into the current atlas.

## Registration and mesh specification

The body uses meters and Y-up. Right-hand extraction uses the rigid mapping `[.920-y, z-.019, -x-.276]`. Wrist X is distal, Y the volar display direction and Z radial; 1 mm=0.001 world units. Arm skin weights reject unrelated lower-body fragments; intersecting triangles are clipped at the forearm plane. Bones retain native geometry.

Structure names are in `/models/wrist/manifest.json`. Rendering surfaces and solver tetrahedral meshes are separate assets with shared coordinates/correspondence. Section fat, fibers and septa are representative patterns, not measured histology. Skin-derived fat boundaries require collision/self-intersection checks and eventual volumetric segmentation.

Proposed starting solver resolution: 0.1–0.3 mm around the vessel wall and 0.2–0.5 mm beneath pads, followed by convergence testing. These are design starting points, not validated sufficient criteria. Higher visual LOD does not establish solver convergence.

## Individual acquisition records

Record side, handedness, distance from wrist crease, pronation/supination, flexion/extension, skin temperature, patch preload, ultrasound probe pressure, ECG synchronization, artery lumen/wall/depth/curvature, FCR/BR/radius relationships, skin/fat boundaries, contraction phase and finger LED/PD placement. Distinguish systolic/diastolic frames and probe-compression bias.
