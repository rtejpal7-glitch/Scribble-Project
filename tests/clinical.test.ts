import { describe, expect, it } from 'vitest';
import { MedicineMatcher, applyMedicineFix } from '../src/clinical/medicineMatcher';
import { BUILT_IN_MEDICINES } from '../src/clinical/medicines';
import { suggestionWarnings } from '../src/clinical/suggestionSafety';
import { createVoiceDocument, initialVoiceState, voiceReducer } from '../src/state/voiceReducer';

const m = new MedicineMatcher([...BUILT_IN_MEDICINES, 'Tenovate']);
const fix = (text: string) => {
  const issues = m.check(text);
  return issues.reduceRight((t, i) => applyMedicineFix(t, i, i.suggestions[0]), text);
};

describe('medicine dictionary check', () => {
  it('suggests dictionary spellings for misheard / misread names', () => {
    expect(fix('Apply clobetasole cream twice daily')).toBe('Apply clobetasol cream twice daily');
    expect(fix('Start cetrizine 10 mg at night')).toBe('Start cetirizine 10 mg at night');
    expect(fix('Benzoil peroxide gel at night')).toBe('Benzoyl peroxide gel at night');
    expect(fix('Take pantaprazole before breakfast')).toBe('Take pantoprazole before breakfast');
    expect(fix('Monteleukast and fexofenidine')).toBe('Montelukast and fexofenadine');
    expect(fix('tenovat cream')).toBe('Tenovate cream');
  });

  it('leaves ordinary English and Hinglish sentences alone', () => {
    for (const s of [
      'Patient ko do hafte se itching ho rahi hai',
      'Patient is experiencing redness aur itching on both arms',
      'Is patient ko fever nahi hai but mild headache hai',
      'Medicine ko din mein twice lena hai after food',
      'Hi why am Rahul',
      'Follow up after seven days with reports',
      'Isotretinoin 20 mg after food',
    ])
      expect(m.check(s)).toEqual([]);
  });

  it('respects words marked "not a medicine"', () => {
    const allow = new MedicineMatcher(BUILT_IN_MEDICINES, ['cetrizine']);
    expect(allow.check('Start cetrizine')).toEqual([]);
  });
});

describe('sentence suggestion safety', () => {
  it('flags changes to numbers and medicine names', () => {
    expect(suggestionWarnings('Hi why am Rahul', 'Hi I am Rahul', m)).toEqual([]);
    expect(suggestionWarnings('Take 500 mg twice', 'Take 250 mg twice', m)).toEqual(['changes a number or dose']);
    expect(suggestionWarnings('Start hydroxyzine at night', 'Start hydralazine at night', m)).toEqual(['changes a medicine name']);
  });
});

describe('sentence review state', () => {
  it('stores results only for unchanged text and supports dismiss', () => {
    let s = voiceReducer(initialVoiceState, { type: 'load', doc: createVoiceDocument('t') });
    s = voiceReducer(s, {
      type: 'appendSegment',
      segment: { id: 'a', recordingId: 'r', text: 'Hi why am Rahul.', source: 'speech', status: 'final', startMs: 0, endMs: 1, language: 'en-IN', engine: 'x', paragraphStart: true },
    });
    s = voiceReducer(s, { type: 'setReviews', reviews: [{ segmentId: 'a', forText: 'stale text', suggestion: 'x' }] });
    expect(s.doc!.segments[0].review).toBeUndefined();
    s = voiceReducer(s, { type: 'setReviews', reviews: [{ segmentId: 'a', forText: 'Hi why am Rahul.', suggestion: 'Hi I am Rahul.' }] });
    expect(s.doc!.segments[0].review?.suggestion).toBe('Hi I am Rahul.');
    s = voiceReducer(s, { type: 'dismissReview', segmentId: 'a' });
    expect(s.doc!.segments[0].review?.dismissed).toBe(true);
  });
});
