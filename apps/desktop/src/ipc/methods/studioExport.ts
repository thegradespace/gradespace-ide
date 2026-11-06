import { DesktopStudioExportRequest, DesktopStudioExportResult } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Electron from "electron";

import * as ElectronDialog from "../../electron/ElectronDialog.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import { renderStudioDesign } from "../../studio/StudioDesignExport.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

class StudioExportUnauthorizedSenderError extends Schema.TaggedError<StudioExportUnauthorizedSenderError>()(
  "StudioExportUnauthorizedSenderError",
  {},
) {
  override get message(): string {
    return "Design export request was rejected.";
  }
}

const FILTERS: Record<DesktopStudioExportRequest["format"], Electron.FileFilter> = {
  png: { name: "PNG image", extensions: ["png"] },
  pdf: { name: "PDF document", extensions: ["pdf"] },
};

export const exportStudioDesign = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.EXPORT_STUDIO_DESIGN_CHANNEL,
  payload: DesktopStudioExportRequest,
  result: DesktopStudioExportResult,
  handler: Effect.fn("desktop.ipc.studio.exportDesign")(function* (request, event) {
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const main = yield* electronWindow.main;
    if (
      event === undefined ||
      Option.isNone(main) ||
      main.value.webContents.id !== event.sender.id
    ) {
      return yield* new StudioExportUnauthorizedSenderError();
    }
    const path = yield* Path.Path;
    const fileName = path.basename(request.fileName);
    const target = yield* (yield* ElectronDialog.ElectronDialog).pickSavePath({
      owner: yield* electronWindow.focusedMainOrFirst,
      defaultPath: path.join(Electron.app.getPath("downloads"), fileName),
      filters: [FILTERS[request.format]],
    });
    if (Option.isNone(target)) return "cancelled" as const;
    const bytes = yield* renderStudioDesign(request);
    yield* (yield* FileSystem.FileSystem).writeFile(target.value, bytes);
    return "saved" as const;
  }),
});
