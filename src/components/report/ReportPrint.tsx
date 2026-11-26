import { createPortal } from 'react-dom';
import type { ClinicalReport, ClinicProfile } from '../../types/report';
import { lines } from '../../clinical/report';

/**
 * Print layout for a report (A4). Rendered into <body> and only shown while
 * printing, so "Print / PDF" uses the browser's own print dialog: printing on
 * paper or "Save as PDF" both work, and Hindi text prints with system fonts.
 */
export function printReport() {
  const root = document.documentElement;
  root.classList.add('printing-report');
  const done = () => {
    root.classList.remove('printing-report');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  // Some browsers (iOS) return from print() immediately; afterprint still fires.
  setTimeout(() => window.print(), 0);
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Block({ title, items, asList }: { title: string; items: string[]; asList?: boolean }) {
  if (!items.length) return null;
  return (
    <div className="rp-block">
      <div className="rp-h">{title}</div>
      {asList || items.length > 1 ? (
        <ul>
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      ) : (
        <p>{items[0]}</p>
      )}
    </div>
  );
}

export function ReportPrint({ report, clinic }: { report: ClinicalReport; clinic: ClinicProfile }) {
  const meds = report.medicines.filter((m) => m.name.trim());
  const p = report.patient;
  return createPortal(
    <div className="report-print-root speech-text" aria-hidden="true">
      {!report.reviewed && <div className="rp-draft">DRAFT — NOT REVIEWED BY THE DOCTOR</div>}
      <header className="rp-head">
        <div>
          {clinic.clinicName && <div className="rp-clinic">{clinic.clinicName}</div>}
          {clinic.address && <div>{clinic.address}</div>}
          {clinic.phone && <div>Phone: {clinic.phone}</div>}
        </div>
        <div className="rp-doctor">
          {clinic.doctorName && <div className="rp-dname">{clinic.doctorName}</div>}
          {clinic.qualification && <div>{clinic.qualification}</div>}
          {clinic.registrationNo && <div>Reg. no. {clinic.registrationNo}</div>}
        </div>
      </header>
      <div className="rp-patient">
        <span>
          <b>Patient:</b> {p.name || '—'}
        </span>
        <span>
          <b>Age:</b> {p.age || '—'}
        </span>
        <span>
          <b>Sex:</b> {p.sex || '—'}
        </span>
        <span>
          <b>Date:</b> {formatDate(report.visitDate)}
        </span>
      </div>

      <Block title="Chief complaints" items={lines(report.complaints)} asList />
      <Block title="History" items={lines(report.history)} />
      <Block title="Examination" items={lines(report.examination)} />
      <Block title="Diagnosis" items={report.diagnosis.map((d) => d.text.trim()).filter(Boolean)} />

      {meds.length > 0 && (
        <div className="rp-block">
          <div className="rp-rx">℞</div>
          <table className="rp-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Medicine</th>
                <th>Dose</th>
                <th>How often</th>
                <th>When</th>
                <th>How long</th>
              </tr>
            </thead>
            <tbody>
              {meds.map((m, i) => (
                <tr key={m.id}>
                  <td>{i + 1}</td>
                  <td>
                    <b>{[m.name, m.strength].filter(Boolean).join(' ')}</b>
                    {m.route && m.route.toLowerCase() !== 'oral' && <div className="rp-sub">{m.route}</div>}
                    {m.instructions && <div className="rp-sub">{m.instructions}</div>}
                  </td>
                  <td>{m.dose}</td>
                  <td>{m.frequency}</td>
                  <td>{m.timing}</td>
                  <td>{m.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Block title="Investigations" items={lines(report.investigations)} asList />
      <Block title="Advice" items={lines(report.advice)} asList />
      {report.followUp.trim() && (
        <div className="rp-block">
          <b>Follow-up:</b> {report.followUp.trim()}
        </div>
      )}

      <footer className="rp-sign">
        <div className="rp-line" />
        <div>{clinic.doctorName ? `${clinic.doctorName} — signature` : "Doctor's signature"}</div>
      </footer>
    </div>,
    document.body,
  );
}
