import type { DesktopVideoEditor } from "@t3tools/contracts";

/** A folder to look in, the names in it that are the editor, and its program inside a match. */
interface EditorSearch {
  readonly editor: DesktopVideoEditor;
  readonly folder: string;
  readonly match: RegExp;
  readonly program?: (match: string) => string;
}

export function videoEditorSearches(
  platform: NodeJS.Platform,
  env: { readonly home: string; readonly programFiles: string | undefined },
): readonly EditorSearch[] {
  if (platform === "darwin") {
    return ["/Applications", `${env.home}/Applications`].flatMap((applications) => [
      // The App Store build sits in Applications; Blackmagic's installer nests it in a folder.
      { editor: "resolve", folder: applications, match: /^DaVinci Resolve( Studio)?\.app$/ },
      {
        editor: "resolve",
        folder: applications,
        match: /^DaVinci Resolve$/,
        program: () => "DaVinci Resolve.app",
      },
      // Adobe installs "Adobe Premiere Pro 2025/Adobe Premiere Pro 2025.app".
      {
        editor: "premiere",
        folder: applications,
        match: /^Adobe Premiere Pro( \d{4})?$/,
        program: (match) => `${match}.app`,
      },
      { editor: "final-cut", folder: applications, match: /^Final Cut Pro( Trial)?\.app$/ },
    ]);
  }
  if (platform === "win32" && env.programFiles !== undefined) {
    return [
      {
        editor: "resolve",
        folder: `${env.programFiles}\\Blackmagic Design`,
        match: /^DaVinci Resolve$/,
        program: () => "Resolve.exe",
      },
      {
        editor: "premiere",
        folder: `${env.programFiles}\\Adobe`,
        match: /^Adobe Premiere Pro( \d{4})?$/,
        program: () => "Adobe Premiere Pro.exe",
      },
    ];
  }
  return [];
}

/** The newest install of each editor, given what each folder holds. */
export function pickVideoEditorApps(
  platform: NodeJS.Platform,
  searches: readonly EditorSearch[],
  listing: (folder: string) => readonly string[],
): ReadonlyMap<DesktopVideoEditor, string> {
  const join = (...parts: string[]) => parts.join(platform === "win32" ? "\\" : "/");
  const found = new Map<DesktopVideoEditor, string>();
  for (const search of searches) {
    const apps = listing(search.folder)
      .filter((name) => search.match.test(name))
      .flatMap((name) => {
        if (search.program === undefined) return [join(search.folder, name)];
        const program = search.program(name);
        return listing(join(search.folder, name)).includes(program)
          ? [join(search.folder, name, program)]
          : [];
      });
    const newest = [...apps, found.get(search.editor) ?? ""].toSorted().at(-1);
    if (newest) found.set(search.editor, newest);
  }
  return found;
}

export interface VideoEditorLaunch {
  readonly command: string;
  readonly args: readonly string[];
  /** Also show the file, because the editor will not import it from the command line. */
  readonly reveal: boolean;
}

/**
 * Resolve only opens its own project files this way and ignores an .fcpxml, so it is launched
 * and the file is shown for File → Import → Timeline.
 */
export function videoEditorLaunch(
  platform: NodeJS.Platform,
  editor: DesktopVideoEditor,
  app: string,
  file: string,
): VideoEditorLaunch {
  const takesFile = editor !== "resolve";
  if (platform === "darwin") {
    return { command: "open", args: ["-a", app, ...(takesFile ? [file] : [])], reveal: !takesFile };
  }
  return { command: app, args: takesFile ? [file] : [], reveal: !takesFile };
}

export const isVideoTimelineFile = (path: string) => /\.(fcpxml|xml|edl)$/i.test(path);
