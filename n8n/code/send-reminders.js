// Workflow 2, step 2: one reminder per overdue loan (logged mock; swap for Send Email),
// then build the signed write-back. Convex makes the write-back idempotent on reminderKey
// (one per loan per day), so a retried request never creates a second record.
const response = $input.first().json;
const loans = Array.isArray(response.loans) ? response.loans : [];

return loans.map((loan) => {
  let status = "sent";
  let detail;
  try {
    const subject = `Reminder: the ${loan.toolName} was due back on ${loan.endDate}`;
    console.log(`[lendloop] remind ${loan.reminderKey} -> ${loan.borrower.email}: ${subject}`);
  } catch (e) {
    status = "failed";
    detail = String(e && e.message ? e.message : e).slice(0, 300);
  }
  const writeBack = { loanId: loan.loanId, reminderKey: loan.reminderKey, status };
  if (detail) writeBack.detail = detail;
  return { json: { reminderKey: loan.reminderKey, ...lendloopSignedRequest("/n8n/reminder-status", writeBack) } };
});
