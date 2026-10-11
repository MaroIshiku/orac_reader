const emptyStatus = () => ({ all: false, books: [], parts: [] });

export function pushSupportMessage(checkPermission = true) {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios && !matchMedia("(display-mode: standalone)").matches && navigator.standalone !== true) return "Auf iPhone und iPad müssen Benachrichtigungen in der zum Home-Bildschirm hinzugefügten App aktiviert werden.";
  if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "Benachrichtigungen sind hier nicht verfügbar. Auf iPhone und iPad muss OracReader zuerst als App zum Home-Bildschirm hinzugefügt werden.";
  if (checkPermission && Notification.permission === "denied") return "Benachrichtigungen sind für OracReader im Browser oder in den Systemeinstellungen blockiert.";
  return "";
}

async function post(path, body) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Benachrichtigungen konnten nicht aktualisiert werden.");
  return data;
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration ? registration.pushManager.getSubscription() : null;
}

export async function pushStatus() {
  if (pushSupportMessage(false)) return emptyStatus();
  const subscription = await currentSubscription();
  return subscription ? post("/api/push/status", { subscription }) : emptyStatus();
}

function applicationServerKey(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

export async function setPushScope(scope, enabled, target = "") {
  const unsupported = pushSupportMessage(enabled);
  if (unsupported) throw new Error(unsupported);
  if (enabled && Notification.permission !== "granted") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Ohne Erlaubnis des Geräts können keine Benachrichtigungen gesendet werden.");
  }
  let subscription = await currentSubscription();
  if (enabled && !subscription) {
    const response = await fetch("/api/push/config");
    if (!response.ok) throw new Error("Der Benachrichtigungsdienst ist nicht erreichbar.");
    const { publicKey } = await response.json();
    const registration = await navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent("__APP_VERSION__")}`, { scope: "/", updateViaCache: "none" });
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey) });
  }
  if (!subscription) return emptyStatus();
  const choice = { subscription, scope, enabled };
  if (scope === "book") choice.bookId = target;
  if (scope === "part") choice.path = target;
  const status = await post("/api/push/subscription", choice);
  if (!status.all && !status.books.length && !status.parts.length) await subscription.unsubscribe();
  return status;
}
