/**
 * The 49 facility rows from the export, verbatim. `role` is inferred from the
 * registry id prefix and the operator name: TXR/ILR ids are transporters,
 * commercial waste sites are TSDFs, the rest are generators. Roles only steer
 * manifest wiring (generator -> transporter -> TSDF).
 */
export type FacilityRole = "generator" | "transporter" | "tsdf";

export type FacilityRow = {
  registryId: string;
  label: string;
  role: FacilityRole;
};

export const FACILITIES: FacilityRow[] = [
  { registryId: "TXD000719518", label: "VLS Texas Molecular", role: "tsdf" },
  { registryId: "TXD515102755", label: "ExxonMobil Baytown Complex", role: "generator" },
  { registryId: "TXD620016210", label: "Pemex Deer Park", role: "generator" },
  {
    registryId: "TXD042027594",
    label: "Chevron Phillips Chemical Cedar Bayou Plant",
    role: "generator",
  },
  {
    registryId: "TXD340285410",
    label: "LyondellBasell Channelview Complex",
    role: "generator",
  },
  {
    registryId: "TXD865034110",
    label: "LyondellBasell Houston Refinery",
    role: "generator",
  },
  {
    registryId: "TXD088532553",
    label: "INEOS Olefins & Polymers USA La Porte",
    role: "generator",
  },
  { registryId: "TXD050870526", label: "Covestro LLC Baytown", role: "generator" },
  {
    registryId: "TXD954732021",
    label: "Occidental Chemical Deer Park",
    role: "generator",
  },
  {
    registryId: "TXD441233670",
    label: "Occidental Chemical La Porte",
    role: "generator",
  },
  { registryId: "TXD792824398", label: "Lubrizol Deer Park", role: "generator" },
  { registryId: "TXD229183555", label: "Kuraray America Pasadena", role: "generator" },
  { registryId: "TXD352786078", label: "Celanese Clear Lake Plant", role: "generator" },
  { registryId: "TXD242744151", label: "BASF Corporation Pasadena", role: "generator" },
  { registryId: "TXD391444741", label: "Air Liquide Bayport", role: "generator" },
  {
    registryId: "TXD750745563",
    label: "Intercontinental Terminals Company Deer Park",
    role: "generator",
  },
  { registryId: "TXD424874836", label: "Vopak Terminal Deer Park", role: "generator" },
  {
    registryId: "TXD658451543",
    label: "Kaneka North America La Porte",
    role: "generator",
  },
  { registryId: "TXD493080867", label: "Goodyear Chemical Bayport", role: "generator" },
  { registryId: "TXD791240867", label: "Arkema Inc. Crosby", role: "generator" },
  { registryId: "TXD232817176", label: "TPC Group Houston Plant", role: "generator" },
  {
    registryId: "TXD191666610",
    label: "Ascend Performance Materials Pasadena",
    role: "generator",
  },
  { registryId: "TXD142556694", label: "Evonik Corporation Houston", role: "generator" },
  {
    registryId: "TXD385712593",
    label: "Dow Chemical La Porte Operations",
    role: "generator",
  },
  {
    registryId: "TXD424641114",
    label: "Huntsman Corporation Bayport",
    role: "generator",
  },
  { registryId: "TXD065381027", label: "Braskem America La Porte", role: "generator" },
  {
    registryId: "TXD298831110",
    label: "Phillips 66 Pasadena Terminal",
    role: "generator",
  },
  { registryId: "TXD720437972", label: "Valero Houston Refinery", role: "generator" },
  {
    registryId: "TXD976089325",
    label: "Marathon Galveston Bay Refinery",
    role: "generator",
  },
  {
    registryId: "TXD925855773",
    label: "Enterprise Products Mont Belvieu",
    role: "generator",
  },
  {
    registryId: "TXD967033255",
    label: "Kinder Morgan Pasadena Terminal",
    role: "generator",
  },
  { registryId: "TXD150442958", label: "Shell Chemical LP Deer Park", role: "generator" },
  { registryId: "TXD816757788", label: "Kraton Polymers Houston", role: "generator" },
  {
    registryId: "LAD727050419",
    label: "Denka Performance Elastomer LLC",
    role: "generator",
  },
  {
    registryId: "NCD844706749",
    label: "The Chemours Company Fayetteville Works",
    role: "generator",
  },
  {
    registryId: "LAD663309076",
    label: "PCS Nitrogen Fertilizer LP",
    role: "generator",
  },
  {
    registryId: "IDD698205633",
    label: "J.R. Simplot Company Don Plant",
    role: "generator",
  },
  { registryId: "TXD952065253", label: "Clean Harbors Deer Park LLC", role: "tsdf" },
  { registryId: "TXD225985513", label: "US Ecology Texas Robstown", role: "tsdf" },
  { registryId: "TXD769756771", label: "Veolia Port Arthur", role: "tsdf" },
  { registryId: "TXD565579440", label: "WM Disposal Services of Texas", role: "tsdf" },
  {
    registryId: "TXR000012345",
    label: "Clean Harbors Environmental Services",
    role: "transporter",
  },
  { registryId: "TXR000023456", label: "US Ecology Texas Inc.", role: "transporter" },
  {
    registryId: "TXR000034567",
    label: "Veolia ES Technical Solutions LLC",
    role: "transporter",
  },
  {
    registryId: "TXR000045678",
    label: "Heritage-Crystal Clean LLC",
    role: "transporter",
  },
  { registryId: "TXR000056789", label: "Sprint Waste Services LP", role: "transporter" },
  {
    registryId: "ILR000067890",
    label: "Stericycle Environmental Solutions",
    role: "transporter",
  },
  {
    registryId: "TXR000078901",
    label: "Gulf Coast Environmental Systems",
    role: "transporter",
  },
  {
    registryId: "TXR000089012",
    label: "Cyn Environmental Services",
    role: "transporter",
  },
];

/** Documents from the export, each resolving to a facility via A-04 NER. */
export const DOCUMENTS: { id: string; registryId: string; label: string }[] = [
  { id: "denka_cafo", registryId: "LAD727050419", label: "Denka Performance Elastomer LLC" },
  {
    id: "chemours_cd",
    registryId: "NCD844706749",
    label: "The Chemours Company Fayetteville Works",
  },
  {
    id: "chemours_cp",
    registryId: "NCD844706749",
    label: "The Chemours Company Fayetteville Works",
  },
  { id: "pcs_cd", registryId: "LAD663309076", label: "PCS Nitrogen Fertilizer LP" },
  { id: "simplot_cd", registryId: "IDD698205633", label: "J.R. Simplot Company Don Plant" },
  {
    id: "stericycle_cp",
    registryId: "ILR000067890",
    label: "Stericycle Environmental Solutions",
  },
  {
    id: "stericycle_set",
    registryId: "ILR000067890",
    label: "Stericycle Environmental Solutions",
  },
];

/** Manifest tracking numbers from the export. */
export const MANIFEST_IDS: string[] = [
  "346581037ELC",
  "583052521HMV",
  "266760939ELC",
  "265853465JJK",
  "602085546FLE",
  "776852307ELC",
  "676993646HMV",
  "117952568HMV",
  "735866647FLE",
  "776094156HMV",
  "263318171HMV",
];

/** A-04 identity resolutions: source-system name -> canonical facility. */
export const ALIASES: { label: string; registryId: string }[] = [
  { label: "Texas Molecular LP", registryId: "TXD000719518" },
  { label: "US Ecology Texas Inc.", registryId: "TXD225985513" },
  { label: "Clean Harbors Deer Park Inc.", registryId: "TXD952065253" },
];
