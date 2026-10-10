const ID = "livekit-animated-avatars";
const FLAG = "livekitAnimatedAvatar";

const records = new Map();
const lastSpeech = new Map();
const failed = new Set();

let timer;
let ready = false;
let settingsWindow;
let playbackWarning = false;

const getClient = () => game.webrtc?.client?._liveKitClient;
const isVideo = src => /\.(webm|mp4)(?:[?#]|$)/i.test(src);

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function validatePath(value) {
  const src = String(value ?? "").trim();
  if (!src) return "";

  if (
    /^(javascript|data|blob|file):/i.test(src) ||
    src.startsWith("//") ||
    (/^[a-z][a-z\d+.-]*:/i.test(src) && !src.startsWith("https://"))
  ) {
    throw new Error("Use a Foundry file path or an HTTPS URL.");
  }

  if (!/\.(webm|mp4|png|jpe?g|webp|gif|avif|svg)(?:[?#]|$)/i.test(src)) {
    throw new Error("Choose an image, WebM or MP4 file.");
  }

  return src;
}

function fileURL(src) {
  return src.startsWith("https://")
    ? src
    : foundry.utils.getRoute(src);
}

function releaseVideos(root) {
  root?.querySelectorAll("video").forEach(video => {
    video.pause();
    video.removeAttribute("src");
    video.load();
  });
}

function removePortrait(tile, record) {
  releaseVideos(record.overlay);
  record.overlay.remove();

  if (
    record.original &&
    record.original.style.visibility === "hidden"
  ) {
    record.original.style.visibility = record.oldVisibility;
  }

  if (
    record.changedPosition &&
    record.container.style.position === "relative"
  ) {
    record.container.style.position = record.oldPosition;
  }

  records.delete(tile);
}

function stop() {
  clearInterval(timer);
  timer = undefined;

  for (const [tile, record] of [...records]) {
    removePortrait(tile, record);
  }

  lastSpeech.clear();
}

function start() {
  stop();

  if (!ready || !game.settings.get(ID, "enabled")) return;

  playbackWarning = false;
  timer = setInterval(safeUpdate, 100);
  safeUpdate();
}

function makeMedia(src, fit, tile, signature) {
  const video = isVideo(src);
  const media = document.createElement(video ? "video" : "img");

  Object.assign(media.style, {
    width: "100%",
    height: "100%",
    objectFit: fit,
    display: "none"
  });

  if (video) {
    media.muted = true;
    media.defaultMuted = true;
    media.loop = true;
    media.playsInline = true;
    media.preload = "auto";
  } else {
    media.alt = "Character avatar";
    media.draggable = false;
  }

  media.addEventListener("error", () => {
    if (failed.has(signature)) return;
    failed.add(signature);

    const record = records.get(tile);

    if (record?.signature === signature) {
      removePortrait(tile, record);
    }

    console.warn(ID, "Could not load avatar:", src);
    ui.notifications.warn(
      "Avatar could not load. Check its path or video codec."
    );
  });

  media.src = fileURL(src);
  return media;
}

function participants(client) {
  const room = client?.liveKitRoom;
  const people = new Map(client?.liveKitParticipants ?? []);

  if (room?.localParticipant) {
    people.set(game.user.id, room.localParticipant);
  }

  for (const participant of room?.remoteParticipants?.values?.() ?? []) {
    try {
      const userId = JSON.parse(participant.metadata ?? "{}").fvttUserId;
      if (userId) people.set(userId, participant);
    } catch {
      // Ignore participants without Foundry metadata.
    }
  }

  return people;
}

function update() {
  const client = getClient();

  if (!client || client.useExternalAV) {
    for (const [tile, record] of [...records]) {
      removePortrait(tile, record);
    }

    lastSpeech.clear();
    return;
  }

  const connected = client.liveKitRoom?.state === "connected";
  const people = participants(client);
  const now = Date.now();

  for (const [tile, record] of [...records]) {
    if (!tile.isConnected || !record.overlay.isConnected) {
      removePortrait(tile, record);
    }
  }

  for (const tile of document.querySelectorAll(".camera-view[data-user]")) {
    const userId = tile.dataset.user;
    const user = game.users.get(userId);
    const container = tile.querySelector(".video-container");
    const camera = tile.querySelector("video.user-camera");
    const artwork = user?.getFlag("world", FLAG) ?? {};

    if (
      !user ||
      !container ||
      (camera && !camera.hidden) ||
      (!artwork.idle && !artwork.talking)
    ) {
      if (records.has(tile)) {
        removePortrait(tile, records.get(tile));
      }
      continue;
    }

    const participant = people.get(userId);
    const microphones = [
      ...(participant?.audioTrackPublications?.values?.() ?? [])
    ].filter(track => track.source === "microphone");

    const muted = userId === game.user.id
      ? !client.audioTrack || client.audioTrack.isMuted
      : !microphones.some(track => !track.isMuted);

    const speaking =
      connected && !muted && participant?.isSpeaking === true;

    if (!connected || muted) {
      lastSpeech.delete(userId);
    } else if (speaking) {
      lastSpeech.set(userId, now);
    }

    const active = connected && !muted && (
      speaking ||
      (
        lastSpeech.has(userId) &&
        now - lastSpeech.get(userId) < 350
      )
    );

    let idle;
    let talking;

    try {
      idle = validatePath(artwork.idle) || user.avatar;
      talking = validatePath(artwork.talking) || idle;
    } catch {
      if (records.has(tile)) {
        removePortrait(tile, records.get(tile));
      }
      continue;
    }

    if (!idle) continue;

    const fit = artwork.fit === "cover" ? "cover" : "contain";
    const signature = JSON.stringify([userId, idle, talking, fit]);
    let record = records.get(tile);

    if (
      record &&
      (
        record.signature !== signature ||
        record.container !== container
      )
    ) {
      removePortrait(tile, record);
      record = undefined;
    }

    if (failed.has(signature)) continue;

    if (!record) {
      const overlay = document.createElement("div");

      Object.assign(overlay.style, {
        position: "absolute",
        inset: "0",
        zIndex: "2",
        pointerEvents: "none",
        overflow: "hidden",
        borderRadius: "inherit",
        border: "3px solid transparent",
        boxSizing: "border-box"
      });

      const media = [makeMedia(idle, fit, tile, signature)];

      if (talking !== idle) {
        media.push(makeMedia(talking, fit, tile, signature));
      }

      const original = container.querySelector("img.user-avatar");
      const oldVisibility = original?.style.visibility ?? "";
      const oldPosition = container.style.position;

      const changedPosition =
        getComputedStyle(container).position === "static";

      if (changedPosition) container.style.position = "relative";
      if (original) original.style.visibility = "hidden";

      overlay.append(...media);
      container.appendChild(overlay);

      record = {
        overlay,
        media,
        original,
        oldVisibility,
        container,
        oldPosition,
        changedPosition,
        signature,
        index: null
      };

      records.set(tile, record);
    }

    record.overlay.style.borderColor = active
      ? String(user.color || "#68d391")
      : "transparent";

    const index = active && record.media.length > 1 ? 1 : 0;

    if (record.index === index) continue;
    record.index = index;

    record.media.forEach((media, position) => {
      media.style.display = position === index ? "block" : "none";

      if (media.tagName !== "VIDEO") return;

      if (position !== index) {
        media.pause();
      } else {
        media.play().catch(() => {
          if (playbackWarning) return;
          playbackWarning = true;

          ui.notifications.warn(
            "Click inside Foundry to allow avatar video playback."
          );
        });
      }
    });
  }
}

function safeUpdate() {
  try {
    update();
  } catch (error) {
    stop();
    console.error(ID, error);

    ui.notifications.error(
      "Animated avatars stopped. Check the browser console."
    );
  }
}

class AvatarSettings extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "livekit-animated-avatars-settings",
    window: {
      title: "LiveKit Animated Avatars",
      resizable: true
    },
    position: {
      width: 600,
      height: "auto"
    }
  };

  constructor(options = {}) {
    super(options);
    this.userId = game.user.id;
  }

  async _renderHTML() {
    const users = game.user.isGM ? game.users.contents : [game.user];

    if (!users.some(user => user.id === this.userId)) {
      this.userId = game.user.id;
    }

    const target = game.users.get(this.userId);
    const artwork = target.getFlag("world", FLAG) ?? {};
    const enabled = game.settings.get(ID, "enabled");
    const canBrowse = game.user.can("FILES_BROWSE");

    const root = document.createElement("div");

    root.innerHTML = `
      <form style="display:flex;flex-direction:column;gap:12px;padding:6px">

        <label>
          <input name="enabled" type="checkbox"
            ${enabled ? "checked" : ""}>
          Show animated avatars in this browser
        </label>

        <p class="hint">
          Your viewing choice affects only this browser.
          Saved artwork is shared with the world.
        </p>

        <hr>

        <div class="form-group">
          <label>Configure user</label>
          <select name="userId">
            ${users.map(user => `
              <option value="${escapeHTML(user.id)}"
                ${user.id === this.userId ? "selected" : ""}>
                ${escapeHTML(user.name)}
              </option>
            `).join("")}
          </select>
        </div>

        ${["idle", "talking"].map(key => `
          <div class="form-group">
            <label>
              ${key === "idle" ? "Idle artwork" : "Talking artwork"}
            </label>
            <input name="${key}" type="text"
              value="${escapeHTML(artwork[key])}"
              placeholder="Assets/avatars/character.webm">
          </div>

          <button type="button" data-browse="${key}"
            ${canBrowse ? "" : "disabled"}>
            <i class="fas fa-folder-open"></i>
            Browse / Upload ${key === "idle" ? "Idle" : "Talking"}
          </button>
        `).join("")}

        <p class="hint">
          Use the file picker's Upload control to upload a file.
          Browsing and uploads follow Foundry's role permissions.
        </p>

        <p class="hint">
          Talking artwork is optional. Leave it blank to keep the idle
          animation moving during speech, with a coloured border.
          Leave both paths blank to use the normal portrait.
        </p>

        <div class="form-group">
          <label>Fit</label>
          <select name="fit">
            <option value="contain"
              ${artwork.fit !== "cover" ? "selected" : ""}>
              Show whole character
            </option>
            <option value="cover"
              ${artwork.fit === "cover" ? "selected" : ""}>
              Fill portrait — crop edges
            </option>
          </select>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <b>Idle preview</b>
            <div data-preview="idle"
              style="height:140px;overflow:hidden;background:rgba(0,0,0,.15)">
            </div>
          </div>
          <div>
            <b>Talking preview</b>
            <div data-preview="talking"
              style="height:140px;overflow:hidden;background:rgba(0,0,0,.15)">
            </div>
          </div>
        </div>

        <p class="hint">
          Save before switching users; unsaved edits will be discarded.
          Videos are muted. Actual camera video takes priority.
        </p>

        <footer style="display:flex;gap:8px">
          <button type="submit">
            <i class="fas fa-save"></i> Save Changes
          </button>
          <button type="button" data-clear>Clear Artwork</button>
        </footer>

      </form>
    `;

    return root;
  }

  _replaceHTML(result, content) {
    releaseVideos(content);
    content.replaceChildren(result);
  }

  _onRender(context, options) {
    super._onRender(context, options);

    const form = this.element.querySelector("form");
    const Picker = foundry.applications.apps.FilePicker.implementation;

    const preview = key => {
      const box = form.querySelector(`[data-preview="${key}"]`);

      releaseVideos(box);
      box.replaceChildren();

      let src;

      try {
        src = validatePath(form.elements[key].value);
      } catch {
        box.textContent = "Choose a supported image or video.";
        return;
      }

      if (!src) {
        box.textContent = key === "idle"
          ? "Normal portrait"
          : "Uses idle artwork";
        return;
      }

      const video = isVideo(src);
      const media = document.createElement(video ? "video" : "img");

      Object.assign(media.style, {
        width: "100%",
        height: "100%",
        objectFit: form.elements.fit.value
      });

      if (video) {
        media.muted = true;
        media.loop = true;
        media.playsInline = true;
        media.controls = true;
      }

      media.addEventListener("error", () => {
        box.textContent = "Could not load this file.";
      });

      media.src = fileURL(src);
      box.appendChild(media);

      if (video) media.play().catch(() => {});
    };

    for (const key of ["idle", "talking"]) {
      form.elements[key].addEventListener("change", () => preview(key));

      form.querySelector(`[data-browse="${key}"]`)
        .addEventListener("click", () => {
          new Picker({
            type: "imagevideo",
            current: form.elements[key].value,
            callback: selected => {
              form.elements[key].value = selected;
              preview(key);
            }
          }).render({ force: true });
        });

      preview(key);
    }

    form.elements.fit.addEventListener("change", () => {
      preview("idle");
      preview("talking");
    });

    form.elements.userId.addEventListener("change", () => {
      this.userId = form.elements.userId.value;
      this.render({ force: true });
    });

    form.querySelector("[data-clear]").addEventListener("click", () => {
      form.elements.idle.value = "";
      form.elements.talking.value = "";
      preview("idle");
      preview("talking");
    });

    form.addEventListener("submit", async event => {
      event.preventDefault();

      const button = form.querySelector('[type="submit"]');
      button.disabled = true;

      try {
        const target = game.users.get(this.userId);

        if (
          !target ||
          (!game.user.isGM && target.id !== game.user.id)
        ) {
          throw new Error("You can only configure your own avatar.");
        }

        const artwork = {
          idle: validatePath(form.elements.idle.value),
          talking: validatePath(form.elements.talking.value),
          fit: form.elements.fit.value === "cover"
            ? "cover"
            : "contain"
        };

        await target.setFlag("world", FLAG, artwork);

        failed.clear();

        await game.settings.set(
          ID,
          "enabled",
          form.elements.enabled.checked
        );

        start();
        ui.notifications.info("Avatar settings saved.");
      } catch (error) {
        console.error(ID, error);
        ui.notifications.error(error.message ?? String(error));
      } finally {
        button.disabled = false;
      }
    });
  }

  async close(options) {
    releaseVideos(this.element);
    return super.close(options);
  }
}

function openSettings() {
  if (!settingsWindow) settingsWindow = new AvatarSettings();
  return settingsWindow.render({ force: true });
}

Hooks.once("init", () => {
  game.settings.register(ID, "enabled", {
    name: "Show animated avatars in this browser",
    hint: "Each browser chooses independently whether to display animations.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => start()
  });

  game.settings.registerMenu(ID, "configure", {
    name: "Configure Animated Avatars",
    label: "Configure Avatars",
    hint: "Select or upload idle and talking artwork.",
    icon: "fas fa-user-circle",
    type: AvatarSettings,
    restricted: false
  });
});

Hooks.once("ready", () => {
  window.livekitAvatarTest?.();
  window.livekitAvatarPOC?.stop?.();
  window.livekitAvatarWindowTest?.stop?.();

  ready = true;

  game.modules.get(ID).api = {
    openSettings,
    restart: () => {
      failed.clear();
      start();
    },
    stop
  };

  start();

  document.addEventListener("pointerdown", () => {
    for (const record of records.values()) {
      const media = record.media[record.index ?? 0];

      if (media?.tagName === "VIDEO") {
        media.play().catch(() => {});
      }
    }
  });

  window.addEventListener("beforeunload", stop);
});

Hooks.on("updateUser", () => {
  failed.clear();
  if (timer) safeUpdate();
});

Hooks.on("renderCameraViews", () => {
  if (timer) safeUpdate();
});

Hooks.on("renderCameraPopout", () => {
  if (timer) safeUpdate();
});
