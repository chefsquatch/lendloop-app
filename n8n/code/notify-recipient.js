// Workflow 1, step 2: notify the one person the event concerns. This is the logged mock
// the brief allows; swap this node for Send Email / Slack / Discord in production. It
// only ever sees the fields Convex chose to send (first name, email, tool, dates).
const SUBJECTS = {
  "loan.requested": (e) => `New request to borrow your ${e.toolName} (${e.startDate} to ${e.endDate})`,
  "loan.approved": (e) => `Approved: you can borrow the ${e.toolName} from ${e.startDate} to ${e.endDate}`,
  "loan.declined": (e) => `Declined: your request for the ${e.toolName} was not approved`,
  "loan.returned": (e) => `Marked returned: ${e.toolName}. Thanks for lending responsibly`,
};

return $input.all().map((item) => {
  const { event, duplicate } = item.json;
  if (duplicate) return { json: { eventId: event.eventId, notified: false, reason: "duplicate delivery" } };
  const subject = (SUBJECTS[event.type] || ((e) => `LendLoop update on ${e.toolName}`))(event);
  const message = {
    channel: "mock-email",
    to: event.recipient.email,
    subject,
    text: `Hi ${event.recipient.firstName}, ${subject}.`,
  };
  console.log(`[lendloop] notify ${event.type} ${event.eventId} -> ${message.to}: ${subject}`);
  return { json: { eventId: event.eventId, notified: true, message } };
});
