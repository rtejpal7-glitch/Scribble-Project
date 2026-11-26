/**
 * Consultation report drafted from a dictation transcript.
 *
 * The report only organises what the doctor dictated. Items the server could
 * not find in the transcript carry flags so they are checked before use; the
 * doctor reviews and edits everything.
 */

export type ReportFlag = 'name-not-in-transcript' | 'source-not-found' | 'number-not-in-transcript';

export interface ReportDiagnosis {
  id: string;
  text: string;
  /** Transcript words this came from (as quoted by the model). */
  source: string;
  flags: ReportFlag[];
}

export interface ReportMedicine {
  id: string;
  name: string;
  strength: string;
  dose: string;
  frequency: string;
  timing: string;
  duration: string;
  route: string;
  instructions: string;
  source: string;
  flags: ReportFlag[];
}

export interface ReportPatient {
  name: string;
  age: string;
  sex: string;
}

export interface ClinicalReport {
  version: 1;
  /** When the draft was generated (null if written by hand). */
  generatedAt: number | null;
  model: string | null;
  /** Hash of the transcript the draft was generated from (detects later changes). */
  transcriptHash: string | null;
  updatedAt: number;
  visitDate: string;
  patient: ReportPatient;
  /** One complaint per line, e.g. "Itching (2 weeks)". */
  complaints: string;
  history: string;
  examination: string;
  diagnosis: ReportDiagnosis[];
  medicines: ReportMedicine[];
  /** One per line. */
  investigations: string;
  /** One per line. */
  advice: string;
  followUp: string;
  /** Things the model could not understand; shown for the doctor to check. */
  unclear: string[];
  /** The doctor confirmed they reviewed this report. */
  reviewed: boolean;
}

/** Shape returned by POST /v1/report on the speech server. */
export interface ServerReport {
  patient: ReportPatient;
  chief_complaints: Array<{ complaint: string; duration: string }>;
  history: string;
  examination: string;
  diagnosis: Array<{ text: string; source: string; flags: ReportFlag[] }>;
  medicines: Array<Omit<ReportMedicine, 'id'>>;
  investigations: string[];
  advice: string[];
  follow_up: string;
  unclear: string[];
}

export interface ClinicProfile {
  clinicName: string;
  address: string;
  phone: string;
  doctorName: string;
  qualification: string;
  registrationNo: string;
}

export const FLAG_TEXT: Record<ReportFlag, string> = {
  'name-not-in-transcript': 'Name not found in the dictation',
  'source-not-found': "Couldn't find where this was said",
  'number-not-in-transcript': 'Number not found in the dictation',
};
