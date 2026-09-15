# Wrist Sensing

Collapse the Radial Artery Digital Twin overview to free space for the experiment below.

## Wrist views

The anatomy dropdown, displacement gain and fat thickness share one row below the square 3D viewport.

- Anatomical layers: original hand/wrist bones, muscles, tendons, vessels, nerves and translucent skin.
- Skin surface: focus on the exterior.
- 3D tissue section: a representative block of skin, fat, vessels and supporting structures.
- Surface contours: view deformed tissue heights using contours and a grid.

S/T sections are representative anatomical tissue windows, not Boolean cuts of the original wrist mesh.

## Rotation and zoom

- Horizontal drag in the empty center: roll around the artery's longitudinal axis.
- Option/Alt + horizontal drag: use vessel-axis rotation even over the patch.
- Drag right at the top: clockwise rotation; left reverses it.
- Drag right at the bottom: counterclockwise rotation; left reverses it.
- Vertical drag at the top or bottom: tilt around the current screen-horizontal axis.
- Drag at the side edges: general rotation following the drag direction.
- Right-drag: pan. Wheel: zoom. Double-click: restore camera.

The starting region determines the gesture for its entire duration. Crossing into another region does not switch modes. Clicking the patch prioritizes patch movement.

## Patch and radial artery

Drag the patch directly or with Shift. Arrow keys move by 0.5 mm; Shift+arrow moves by 2 mm. With keyboard focus in the 3D viewport, comma and period rotate the patch by 2.5° per keystroke.

Pads follow wrist curvature. Lateral and depth sliders sit directly below the 3D view; positive depth moves inward. The red radial artery bends while preserving its connection to the hand-side course.

The white snapshot line is the current artery projected into patch coordinates. The yellow line is an algorithm estimate and may differ. Body and arm positions affect geometry, contact and signals together.

## Reset

The ↺ icon restores anatomical view, displacement gain 1×, fat 2.2 mm, manual artery offset zero, default patch position/angle and camera. Electrode-array configuration and whole-body settings remain unchanged.
