# Skin Cross-sections

Enable the integumentary layer in Whole-body Twin and select skin or a marked region to open the central 3D section dialog.

## Structures

Twelve regions have representative skin, dermis and fat thicknesses and curvature. The wrist illustrates artery–tendon–bone relationships, the fingertip has thick epidermis and a fat pad, and the earlobe contains fibrofatty tissue.

Fine keratin, cell, collagen, fat-lobule and gland patterns are mostly procedural section textures, not segmented patient-cell images. Switch between full block, contours, dermis and vessel views.

## Elastic response and optics

Adjust fat thickness and pulsation display gain to compare arterial expansion and surrounding displacement. Bone and tendon neighborhoods constrain deformation. Whole-body skin dialogs and dedicated wrist sections use different reduced deformation paths and must not be interpreted as the same material solver.

Compare wavelength and reflectance/transmittance arrangements. Paths and exit energy visualize representative scattering/attenuation; they are not detector collection efficiency, patient-specific optical properties or validated SpO₂ inversion.

## Performance

The dialog opens a separate WebGL scene and releases it when closed. Offscreen wrist rendering is reduced, but simultaneous detailed body and wrist views still depend on GPU capability. Demo server validation does not measure browser FPS.
