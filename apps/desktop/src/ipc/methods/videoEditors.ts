// @effect-diagnostics nodeBuiltinImport:off -- Launches a GUI editor detached; it must outlive this request.
import {
  DesktopOpenInVideoEditorRequest,
  DesktopOpenInVideoEditorResult,
  DesktopVideoEditor,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Electron from "electron";
import * as NodeChildProcess from "node:child_process";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import {
  isVideoTimelineFile,
  pickVideoEditorApps,
  videoEditorLaunch,
  videoEditorSearches,
} from "../../studio/VideoEditors.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import type { DesktopIpcInvokeEvent } from "../DesktopIpc.ts";

class VideoEditorRequestError extends Schema.TaggedError<VideoEditorRequestError>()(
  "VideoEditorRequestError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

const installedEditors = Effect.fn("desktop.studio.installedVideoEditors")(function* () {
  const { platform } = yield* DesktopEnvironment.DesktopEnvironment;
  const env = yield* HostProcess.Environment;
  const home = yield* HostProcess.HomeDirectory;
  const fs = yield* FileSystem.FileSystem;
  const searches = videoEditorSearches(platform, { home, programFiles: env.ProgramFiles });
  const folders = new Set(searches.map((search) => search.folder));
  // Matches inside a search folder are read too, so list one level below each one.
  const listings = new Map<string, readonly string[]>();
  const read = (folder: string) =>
    fs.readDirectory(folder).pipe(
      Effect.orElseSucceed(() => [] as readonly string[]),
      Effect.tap((names) => Effect.sync(() => listings.set(folder, names))),
    );
  for (const folder of folders) {
    const names = yield* read(folder);
    for (const search of searches.filter((entry) => entry.folder === folder && entry.program)) {
      for (const name of names.filter((entry) => search.match.test(entry))) {
        yield* read(`${folder}${platform === "win32" ? "\\" : "/"}${name}`);
      }
    }
  }
  return pickVideoEditorApps(platform, searches, (folder) => listings.get(folder) ?? []);
});

const requireMainWindowSender = Effect.fn("desktop.studio.requireMainWindowSender")(function* (
  event: DesktopIpcInvokeEvent | undefined,
) {
  const main = yield* (yield* ElectronWindow.ElectronWindow).main;
  if (event === undefined || Option.isNone(main) || main.value.webContents.id !== event.sender.id) {
    return yield* new VideoEditorRequestError({ reason: "Video editor request was rejected." });
  }
});

export const listVideoEditors = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.LIST_VIDEO_EDITORS_CHANNEL,
  payload: Schema.Undefined,
  result: Schema.Array(DesktopVideoEditor),
  handler: Effect.fn("desktop.ipc.studio.listVideoEditors")(function* (_input, event) {
    yield* requireMainWindowSender(event);
    return [...(yield* installedEditors()).keys()];
  }),
});

export const openInVideoEditor = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.OPEN_IN_VIDEO_EDITOR_CHANNEL,
  payload: DesktopOpenInVideoEditorRequest,
  result: DesktopOpenInVideoEditorResult,
  handler: Effect.fn("desktop.ipc.studio.openInVideoEditor")(function* (request, event) {
    yield* requireMainWindowSender(event);
    const file = request.path;
    const exists = yield* (yield* FileSystem.FileSystem)
      .exists(file)
      .pipe(Effect.orElseSucceed(() => false));
    if (!(yield* Path.Path).isAbsolute(file) || !isVideoTimelineFile(file) || !exists) {
      return yield* new VideoEditorRequestError({ reason: "That timeline file was not found." });
    }
    const { platform } = yield* DesktopEnvironment.DesktopEnvironment;
    const app = (yield* installedEditors()).get(request.editor);
    if (app === undefined) {
      Electron.shell.showItemInFolder(file);
      return "revealed" as const;
    }
    const launch = videoEditorLaunch(platform, request.editor, app, file);
    yield* Effect.try({
      try: () =>
        NodeChildProcess.spawn(launch.command, [...launch.args], {
          detached: true,
          stdio: "ignore",
        }).unref(),
      catch: () =>
        new VideoEditorRequestError({ reason: "The video editor could not be started." }),
    });
    if (launch.reveal) Electron.shell.showItemInFolder(file);
    return launch.reveal ? ("revealed" as const) : ("opened" as const);
  }),
});
