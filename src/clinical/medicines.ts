/**
 * Built-in list of generic medicine names commonly prescribed in India.
 * Used only to *suggest* spellings for recognised text; it is not a drug
 * database and carries no dosing information. Clinics add their own brands
 * and formulary in the Medicine dictionary dialog.
 */
export const BUILT_IN_MEDICINES: string[] = [
  // Analgesics / anti-inflammatory
  'paracetamol', 'acetaminophen', 'ibuprofen', 'diclofenac', 'aceclofenac', 'naproxen', 'mefenamic acid', 'etoricoxib',
  'celecoxib', 'ketorolac', 'tramadol', 'tapentadol', 'nimesulide', 'piroxicam', 'indomethacin', 'aspirin', 'serratiopeptidase',
  // Antibiotics
  'amoxicillin', 'clavulanic acid', 'ampicillin', 'cloxacillin', 'azithromycin', 'clarithromycin', 'erythromycin', 'roxithromycin',
  'doxycycline', 'minocycline', 'tetracycline', 'ciprofloxacin', 'ofloxacin', 'levofloxacin', 'moxifloxacin', 'norfloxacin',
  'cefixime', 'cefuroxime', 'cefpodoxime', 'ceftriaxone', 'cefadroxil', 'cephalexin', 'cefdinir', 'cefoperazone', 'linezolid',
  'metronidazole', 'tinidazole', 'ornidazole', 'secnidazole', 'nitrofurantoin', 'cotrimoxazole', 'trimethoprim',
  'sulfamethoxazole', 'clindamycin', 'rifampicin', 'rifaximin', 'isoniazid', 'pyrazinamide', 'ethambutol', 'vancomycin',
  'meropenem', 'piperacillin', 'tazobactam', 'gentamicin', 'amikacin', 'fosfomycin', 'faropenem',
  // Antifungals
  'fluconazole', 'itraconazole', 'ketoconazole', 'clotrimazole', 'miconazole', 'terbinafine', 'luliconazole', 'sertaconazole',
  'griseofulvin', 'amorolfine', 'voriconazole', 'posaconazole', 'nystatin', 'eberconazole', 'efinaconazole', 'ciclopirox',
  'butenafine', 'oxiconazole',
  // Antivirals / antiparasitic
  'acyclovir', 'valacyclovir', 'famciclovir', 'oseltamivir', 'tenofovir', 'entecavir', 'ivermectin', 'albendazole',
  'mebendazole', 'permethrin', 'praziquantel', 'hydroxychloroquine', 'chloroquine', 'artesunate', 'nitazoxanide',
  // Antihistamines / allergy
  'cetirizine', 'levocetirizine', 'fexofenadine', 'loratadine', 'desloratadine', 'bilastine', 'rupatadine', 'ebastine',
  'olopatadine', 'hydroxyzine', 'chlorpheniramine', 'diphenhydramine', 'promethazine', 'cyproheptadine', 'montelukast',
  // Dermatology
  'benzoyl peroxide', 'adapalene', 'tretinoin', 'isotretinoin', 'azelaic acid', 'salicylic acid', 'glycolic acid',
  'niacinamide', 'hydroquinone', 'kojic acid', 'tranexamic acid', 'mometasone', 'clobetasol', 'betamethasone', 'fluticasone',
  'hydrocortisone', 'desonide', 'halobetasol', 'triamcinolone', 'fluocinolone', 'fusidic acid', 'mupirocin',
  'silver sulfadiazine', 'calcipotriol', 'tacrolimus', 'pimecrolimus', 'minoxidil', 'finasteride', 'dutasteride',
  'methotrexate', 'cyclosporine', 'azathioprine', 'apremilast', 'dapsone', 'spironolactone', 'urea', 'lactic acid',
  'calamine', 'crotamiton', 'coal tar', 'zinc oxide', 'nadifloxacin', 'ozenoxacin', 'retapamulin', 'biotin', 'mycophenolate',
  'tofacitinib', 'baricitinib', 'dupilumab', 'secukinumab',
  // Gastro-intestinal
  'pantoprazole', 'omeprazole', 'esomeprazole', 'rabeprazole', 'lansoprazole', 'ranitidine', 'famotidine', 'domperidone',
  'ondansetron', 'metoclopramide', 'itopride', 'levosulpiride', 'sucralfate', 'lactulose', 'bisacodyl', 'loperamide',
  'racecadotril', 'mesalamine', 'ursodeoxycholic acid', 'simethicone', 'dicyclomine', 'drotaverine', 'hyoscine', 'sodium picosulfate',
  // Cardiovascular / lipids / anticoagulants
  'amlodipine', 'telmisartan', 'losartan', 'olmesartan', 'valsartan', 'ramipril', 'enalapril', 'lisinopril', 'metoprolol',
  'atenolol', 'bisoprolol', 'carvedilol', 'propranolol', 'nebivolol', 'hydrochlorothiazide', 'chlorthalidone', 'furosemide',
  'torsemide', 'atorvastatin', 'rosuvastatin', 'simvastatin', 'fenofibrate', 'ezetimibe', 'clopidogrel', 'ticagrelor',
  'prasugrel', 'warfarin', 'acenocoumarol', 'apixaban', 'rivaroxaban', 'dabigatran', 'heparin', 'enoxaparin', 'nitroglycerin',
  'isosorbide mononitrate', 'digoxin', 'amiodarone', 'ivabradine', 'ranolazine', 'cilnidipine', 'nifedipine', 'diltiazem',
  'verapamil', 'prazosin', 'sacubitril', 'trimetazidine',
  // Diabetes
  'metformin', 'glimepiride', 'gliclazide', 'glipizide', 'sitagliptin', 'vildagliptin', 'teneligliptin', 'linagliptin',
  'saxagliptin', 'dapagliflozin', 'empagliflozin', 'canagliflozin', 'pioglitazone', 'voglibose', 'acarbose',
  'insulin glargine', 'insulin aspart', 'insulin lispro', 'semaglutide', 'liraglutide', 'dulaglutide',
  // Respiratory
  'salbutamol', 'levosalbutamol', 'ipratropium', 'tiotropium', 'budesonide', 'formoterol', 'salmeterol', 'beclomethasone',
  'theophylline', 'doxofylline', 'acebrophylline', 'ambroxol', 'bromhexine', 'guaifenesin', 'dextromethorphan', 'codeine',
  'phenylephrine',
  // Neurology / psychiatry
  'amitriptyline', 'nortriptyline', 'escitalopram', 'sertraline', 'fluoxetine', 'paroxetine', 'duloxetine', 'venlafaxine',
  'desvenlafaxine', 'mirtazapine', 'bupropion', 'alprazolam', 'clonazepam', 'lorazepam', 'diazepam', 'etizolam', 'zolpidem',
  'quetiapine', 'olanzapine', 'risperidone', 'aripiprazole', 'haloperidol', 'lithium', 'sodium valproate', 'divalproex',
  'levetiracetam', 'phenytoin', 'carbamazepine', 'oxcarbazepine', 'lamotrigine', 'topiramate', 'gabapentin', 'pregabalin',
  'flunarizine', 'sumatriptan', 'donepezil', 'levodopa', 'carbidopa', 'pramipexole', 'betahistine', 'cinnarizine',
  'propranolol', 'baclofen', 'thiocolchicoside', 'tizanidine', 'chlorzoxazone',
  // Endocrine / hormones / supplements
  'levothyroxine', 'carbimazole', 'methimazole', 'prednisolone', 'methylprednisolone', 'dexamethasone', 'deflazacort',
  'estradiol', 'progesterone', 'dydrogesterone', 'norethisterone', 'medroxyprogesterone', 'letrozole', 'clomiphene',
  'cabergoline', 'bromocriptine', 'testosterone', 'alendronate', 'calcitriol', 'cholecalciferol', 'calcium carbonate',
  'ferrous sulfate', 'ferrous ascorbate', 'folic acid', 'methylcobalamin', 'cyanocobalamin', 'thiamine', 'pyridoxine',
  'zinc sulfate', 'magnesium', 'potassium chloride', 'sodium bicarbonate', 'myo inositol',
  // Urology / gout / others
  'allopurinol', 'febuxostat', 'colchicine', 'tamsulosin', 'silodosin', 'alfuzosin', 'sildenafil', 'tadalafil', 'mirabegron',
  'solifenacin', 'oxybutynin', 'tolterodine', 'tobramycin', 'timolol', 'latanoprost', 'brimonidine',
  'carboxymethylcellulose', 'xylometazoline', 'oxymetazoline', 'lidocaine', 'lignocaine', 'povidone iodine', 'chlorhexidine',
  'hydrogen peroxide',
];
