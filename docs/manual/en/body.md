# Whole-body Twin

Open Whole-body Twin from the top navigation.

## Anatomy and skin

Toggle circulation, organs/respiration, nerves, bones and muscles, and adjust their opacity. The muscular system shows bilateral muscles, tendons and fascia. The integumentary layer starts off; enabling it exposes skin opacity and regional section selection.

Comfort mode starts on. Its circular header switch hides external genital anatomy without changing sensors or physiological signals.

## Motion

- Walk and run: shared motion capture and joint rigging.
- Stand up: rise from a prepared seated pose and remain standing.
- Repeated sit-to-stand: inspect task phase and repetition count.
- Hand grip: repeat preparation, grip, hold and relaxation. This does not measure grip force.
- Bed transfer: sit on the bed behind the standing body, lower sideways, extend the legs and roll supine.

Clinical tasks are authored kinematic sequences, not clinical predictions of strength, blood-pressure response or balance. Pause and play to compare the same phases.

## Sensors and workspace

Select multiple sensor sites or clear all. Settings and waveforms follow the chosen modality. Both side panels collapse; the Active Sensor tip has a close button. Select at least one sensor before exporting data.

## Pulsation and breathing

The arterial 1×/8× setting magnifies visual deformation only. Lung, liver, abdominal and cardiac motion are approximations coupled to body movement. Some organ boundaries use geometric/rendering constraints, not patient-specific contact analysis.

## Greeting and dance

Choose Wave hello or Dance in the Motion controls. Actual CMU motion captures are retargeted to the body rig, with smooth looping and transitions. The greeting raises and waves the right hand; Jazz dance uses the CMU 103_03 Charleston capture. Unmeasured finger articulation is not synthesized.


Nerves and vessels bend continuously around the shoulders, elbows and wrists. Cervical brachial-plexus roots stay attached to the neck when the arms rise. This is geometric deformation, not a nerve-tension or vascular-stress solver.

## Vessel continuity and deformation

Matching open vessel rims are joined using position, radius and orientation. Junctions share joint weights and interpolate pulse/breathing attributes continuously. Mirrored mesh transforms preserve triangle winding so right-sided vessel surfaces remain visible. Connections and subdivision are prepared once at loading; animation uses GPU skinning. Nearby arteries and veins are never joined merely by proximity. Missing capillary beds and physiological flow connections are not invented. This is a geometric research visualization, not a clinically calibrated vascular material or flow–structure solver.
