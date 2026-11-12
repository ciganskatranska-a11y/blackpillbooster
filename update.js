const $ = id => document.getElementById(id);
const megabytes = bytes => (bytes / 1048576).toFixed(1);

$("update").addEventListener("click", () => window.updater.start());
$("later").addEventListener("click", () => window.updater.later());

window.updater.onState(state => {
	document.body.classList.toggle("is-error", state.phase === "error");
	$("versions").textContent = `v${state.current} → v${state.version}`;
	const bar = $("bar");
	const fill = $("fill");
	if (state.phase === "available") {
		$("title").textContent = "Update available";
		$("message").textContent = `Version ${state.version} is out. It downloads in the background and the app restarts when it's ready.`;
		bar.hidden = true;
		$("update").hidden = false;
		$("update").disabled = false;
		$("update").textContent = "Update now";
		$("later").hidden = false;
		$("later").textContent = "Later";
	} else if (state.phase === "downloading") {
		const percent = Math.round(state.percent || 0);
		$("title").textContent = `Downloading ${percent}%`;
		$("message").textContent = state.total ? `${megabytes(state.transferred)} of ${megabytes(state.total)} MB` : "Starting the download.";
		bar.hidden = false;
		bar.classList.remove("is-busy");
		fill.style.width = `${percent}%`;
		$("update").disabled = true;
		$("update").textContent = "Downloading";
		$("later").textContent = "Hide";
	} else if (state.phase === "installing") {
		$("title").textContent = "Installing";
		$("message").textContent = "Blackpill Booster closes, updates and opens again in a few seconds.";
		bar.hidden = false;
		bar.classList.add("is-busy");
		fill.style.width = "";
		$("update").hidden = true;
		$("later").hidden = true;
	} else if (state.phase === "error") {
		$("title").textContent = "Update failed";
		$("message").textContent = state.error || "Something went wrong. It will try again next time you open the app.";
		bar.hidden = true;
		$("update").hidden = false;
		$("update").disabled = false;
		$("update").textContent = "Try again";
		$("later").hidden = false;
		$("later").textContent = "Close";
	}
});
