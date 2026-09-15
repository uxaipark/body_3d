# References and data sources

Reviewed 2026-09-13. Preference was given to public originals, author repositories, and official documentation. Some PubMed/publisher sources were reviewed through abstracts or public search results; this does not imply completed raw-data acquisition, resegmentation, or license review. The text distinguishes reported measurements from implementation assumptions. This translation preserves the review date rather than claiming a new literature or regulatory-status review.

| ID | Source | Use and status |
|---|---|---|
| A01 | [Ultrasound evaluation of the radial artery, 2015](https://pubmed.ncbi.nlm.nih.gov/26013978/) | Radial diameter, depth, and posture; PMID 26013978 |
| A02 | [Annals of Anatomy 2021, 151763](https://www.sciencedirect.com/science/article/pii/S0940960221000893) | Distal radial artery measurements in young adults; DOI 10.1016/j.aanat.2021.151763 |
| A03 | [High-resolution ultrasound of forearm vessels and cutaneous nerves](https://pubmed.ncbi.nlm.nih.gov/34866700/) | Compartments and vascular course; PMC8630952 |
| A04 | [Normal Sonographic Anatomy of the Wrist and Hand](https://pubs.rsna.org/doi/10.1148/rg.256055028) | Flexor/extensor compartments, carpal tunnel, tendon sheaths |
| A05 | [US of peripheral nerves: landmark approach](https://pubs.rsna.org/doi/10.1148/rg.2016150088) | Median/ulnar nerves and separate FCR passage |
| A06 | [Radial artery variants study](https://pubmed.ncbi.nlm.nih.gov/23197145/) | Branching, origin, and termination variants |
| D01 | [Kerkhof et al. 2018, The digital human forearm and hand](https://pmc.ncbi.nlm.nih.gov/articles/PMC6183001/) | Matched-specimen CT/MRI/dissection; paper points to MorphoSource P419 |
| D02 | [PIANO MRI data](https://github.com/reyuwei/PIANO_mri_data) | MRI/segmentation, candidate NIMBLE extension; check external data/model terms separately |
| D03 | [OpenHands](https://github.com/abel-research/OpenHands) | Finger-bone statistical models; repository CC BY-SA 4.0 |
| D04 | [BodyParts3D STL conversion](https://github.com/kevin-mattheus-moerman/BodyParts3D/tree/main/assets/BodyParts3D_data/stl) | Current native skin FMA7163 source; retain existing SOMA attribution |
| S01 | [Kaisti et al. 2019, wearable arterial pulse monitoring](https://www.nature.com/articles/s41746-019-0117-x) | MEMS pressure-waveform study; not the same as a capacitive-array circuit |
| S02 | [Flexible pressure-sensor dense arrays, 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8156466/) | Dense pulse-array research; not direct calibration for this capacitive electrode system |
| T01 | [Payne et al. 2006, ECG transit time and beat-to-beat BP](https://pubmed.ncbi.nlm.nih.gov/16141378/) | PEP/PAT distinction and condition-dependent relationships |
| O01 | [Monte Carlo eXtreme](https://mcx.space/) | Official optical forward-solver project |
| V01 | [FDA 2025 pulse oximeter draft](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/pulse-oximeters-medical-purposes-non-clinical-and-clinical-performance-testing-labeling-and) | Recorded as DRAFT at the review date, not final |
| V02 | [FDA 2013 final pulse oximeter guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/pulse-oximeters-premarket-notification-submissions-510ks-guidance-industry-and-food-and-drug) | Existing final guidance; performance comparisons and reference measurements |
| V03 | [AHA cuffless BP scientific statement](https://professional.heart.org/en/science-news/cuffless-devices-for-the-measurement-of-blood-pressure) | Measurement reliability and validation scope |

Measured-noise coefficients and audit reports in the original code are project research records. All raw recordings and statistical analyses were not independently reproduced in this work. External generalization requires the original data and protocol.
