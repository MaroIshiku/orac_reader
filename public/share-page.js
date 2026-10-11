import { pushStatus, pushSupportMessage, setPushScope } from "/push-client.js?v=__APP_VERSION__";

const card = document.querySelector(".share-card");
if (card?.dataset.state === "published") {
  location.replace(card.dataset.destination);
} else if (card?.dataset.state === "scheduled") {
  const reminder = document.querySelector("#shareReminder");
  const reminderStatus = document.querySelector("#shareReminderStatus");
  let enabled = false;
  const renderReminder = () => { reminder.textContent = enabled ? "Erinnerung ausschalten" : "An diesen Teil erinnern"; reminder.setAttribute("aria-pressed", String(enabled)); reminder.disabled = Boolean(pushSupportMessage() && !enabled); };
  const supportMessage = pushSupportMessage();
  if (supportMessage) reminderStatus.textContent = supportMessage;
  renderReminder();
  if (!pushSupportMessage(false)) pushStatus().then((status) => { enabled = status.parts.includes(card.dataset.partId); renderReminder(); }).catch((error) => { reminderStatus.textContent = error.message; });
  reminder.onclick = async () => {
    reminder.disabled = true; reminderStatus.textContent = "Speichere Erinnerung…";
    try { const status = await setPushScope("part", !enabled, location.pathname); enabled = status.parts.includes(card.dataset.partId); renderReminder(); reminderStatus.textContent = enabled ? "Du wirst bei Veröffentlichung einmalig benachrichtigt." : "Erinnerung ausgeschaltet."; }
    catch (error) { reminderStatus.textContent = error.message; }
    finally { renderReminder(); }
  };
  const release = new Date(card.dataset.release).getTime();
  const output = document.querySelector("#shareCountdown");
  const update = () => {
    const remaining = release - Date.now();
    if (remaining <= 0) { location.reload(); return; }
    const days = Math.floor(remaining / 86_400_000);
    const hours = Math.floor(remaining / 3_600_000) % 24;
    const minutes = Math.floor(remaining / 60_000) % 60;
    const seconds = Math.floor(remaining / 1000) % 60;
    output.textContent = `Noch ${days} ${days === 1 ? "Tag" : "Tage"}, ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };
  update(); setInterval(update, 1000);
}
