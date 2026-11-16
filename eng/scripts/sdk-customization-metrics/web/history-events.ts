// Dates marked on the trend charts: changes in how libraries were scanned or reviewed, which
// move the numbers without any change to the SDK code. Add an entry when a run re-reviews
// libraries that already had assessments, or a rule change rescans them.
export interface HistoryEvent {
  // UTC date (YYYY-MM-DD). The marker sits before the first observation on or after it.
  date: string;
  label: string;
  note: string;
}

export const HISTORY_EVENTS: HistoryEvent[] = [
  {
    date: "2026-11-16",
    label: "JavaScript rule",
    note: "JavaScript libraries were rescanned under the layout rule agreed with the JavaScript team: no generated folder means fully generated, src/generated/ means a full wrapper, and generated/ means the merge flow, where only what src/ changes is handwritten. JavaScript joins the handwritten line counts and customized-library numbers from here; its earlier reviews were made against whole src/ files and are replaced as libraries are re-reviewed.",
  },
  {
    date: "2026-11-04",
    label: "Review re-run",
    note: "61 .NET and Java libraries were rescanned and re-reviewed under new rules (.NET: everything outside Generated/ is handwritten; Java: report what a customization changes, not the wiring). This run grouped related code into fewer findings, so finding counts for these libraries dropped without any code change. Handwritten lines rose by about 10,000 in the .NET libraries because files outside Generated/ that kept a copied generated header now count as handwritten.",
  },
];
