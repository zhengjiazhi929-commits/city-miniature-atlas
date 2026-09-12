# Hong Kong Observation Wheel — sources and scope

Checked 2026-09-08. Original procedural wheel, cabins, supports, waterfront and
city backdrop; no source photographs or operator branding are redistributed.

- [Hong Kong Observation Wheel operator](https://hkow.hk/): Central waterfront address, observation-wheel purpose and 60-metre real-world height. The operator's [February 2024 aerial photograph](https://hkow.hk/wp-content/uploads/2024/09/Hong-Kong-Observation-Wheel-Drone04-Feb-2024-scaled.jpg) was visually inspected in the browser; red cabin frames, dark glazing and pale structural members guided a material refinement.
- [Central and Western District Council — original wheel project introduction](https://www.districtcouncils.gov.hk/central/doc/2012_2015/en/working_groups_doc/harbourfront/969/20140514-WGCWDH-Paper-5-2014.pdf): primary project record identifies the wheel's 42 gondolas. The model uses 42 cabins.
- [IFC operator — One & Two ifc](https://ifc.com.hk/en/office/one-two-ifc/): background tower identity and finial crown. IFC stands west of the Observation Wheel area; the model compresses distance and tower scale.

Mechanical behavior: the wheel rotates around a horizontal axle; all cabin
instances translate around the rim while retaining an upright orientation.
The dynamic scene uses four instanced cabin material meshes so 42 cabins do not
create hundreds of independent render calls.

Artistic treatment: pale structural steel, red cabin frames and dark glazing aid
legibility at miniature scale. Park paths, ticket-office massing, planting,
surrounding buildings and waterfront shape are simplified. The scene does not
reproduce a current venue plan, claim real-world measured dimensions, or encode
opening hours and ticket prices.
