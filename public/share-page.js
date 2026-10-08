const card = document.querySelector(".share-card");
if (card?.dataset.state === "published") {
  location.replace(card.dataset.destination);
} else if (card?.dataset.state === "scheduled") {
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
