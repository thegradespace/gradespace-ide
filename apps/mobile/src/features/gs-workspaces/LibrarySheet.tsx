import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  filterLibrary,
  formatBytes,
  LIBRARY_CATEGORIES,
  LIBRARY_CATEGORY_NAMES,
  libraryCounts,
  libraryReuse,
} from "@t3tools/client-runtime/library";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  LibraryCategory,
  LibraryItem,
  LibraryReport,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { Sheet } from "../../components/ui/Sheet";
import { cn } from "../../lib/cn";
import { useServerConfigs } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ListPillButton } from "./MailHome";
import { requestNewTaskSeed, useWorkspacePreferences } from "./workspacePreferences";

const TILE: Readonly<Record<LibraryCategory, string>> = {
  deck: "bg-primary",
  design: "bg-adaptive-emerald-600-400",
  writing: "bg-adaptive-amber-700-300",
  video: "bg-danger-foreground",
  application: "bg-adaptive-neutral-400-500",
  other: "bg-subtle",
};

const dateLabel = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

/** The phone's Library: everything agents made on the computer, with Recently deleted. */
export function LibrarySheet(props: {
  readonly onClose: () => void;
  readonly onStartNewTask: (() => void) | null;
}) {
  const serverConfigs = useServerConfigs();
  const environmentId =
    [...serverConfigs].find(
      ([, config]) => config?.environment.capabilities.library === true,
    )?.[0] ?? null;
  return (
    <Sheet title="Library" onClose={props.onClose}>
      {environmentId === null ? (
        <Text textRole="footnote" className="px-4 pt-2 text-foreground-muted">
          Update Gradespace on your computer to see everything your agents made.
        </Text>
      ) : (
        <LibraryQuery environmentId={environmentId} {...props} />
      )}
    </Sheet>
  );
}

function LibraryQuery(props: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
  readonly onStartNewTask: (() => void) | null;
}) {
  const query = serverEnvironment.libraryList({ environmentId: props.environmentId, input: {} });
  const result = useAtomValue(query);
  const refresh = useAtomRefresh(query);
  if (!AsyncResult.isSuccess(result)) {
    return (
      <Text textRole="footnote" className="px-4 pt-2 text-foreground-muted">
        Gathering everything your agents made…
      </Text>
    );
  }
  return <LibraryBody {...props} report={result.value} onChanged={refresh} />;
}

function LibraryBody(props: {
  readonly environmentId: EnvironmentId;
  readonly report: LibraryReport;
  readonly onChanged: () => void;
  readonly onClose: () => void;
  readonly onStartNewTask: (() => void) | null;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<LibraryCategory | "all">("all");
  const [largest, setLargest] = useState(false);
  const { setActive } = useWorkspacePreferences();
  const remove = useAtomCommand(serverEnvironment.deleteLibraryItems, { reportFailure: false });
  const restore = useAtomCommand(serverEnvironment.restoreLibraryItems, { reportFailure: false });
  const empty = useAtomCommand(serverEnvironment.emptyLibraryTrash, { reportFailure: false });
  const counts = libraryCounts(props.report.items);
  const shown = filterLibrary(props.report.items, {
    category,
    query,
    sort: largest ? "largest" : "newest",
  });
  const trashBytes = props.report.trash.reduce((total, item) => total + item.sizeBytes, 0);

  const report = (result: AtomCommandResult<unknown, unknown>, title: string) => {
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    const failure = squashAtomCommandFailure(result);
    const conflict =
      failure &&
      typeof failure === "object" &&
      "reason" in failure &&
      failure.reason === "restoreConflict";
    Dialog.alert(
      title,
      conflict
        ? "Something new is already in its old place on your computer."
        : failure instanceof Error
          ? failure.message
          : "Try again in a moment.",
    );
  };

  const onItem = (item: LibraryItem) => {
    const actions: Parameters<typeof Dialog.alert>[2] = [
      ...(props.onStartNewTask
        ? [
            {
              text: "Reuse as a start",
              onPress: () => {
                const { workspace, prompt } = libraryReuse(item);
                setActive(workspace);
                requestNewTaskSeed(prompt, null);
                props.onClose();
                props.onStartNewTask?.();
              },
            },
          ]
        : []),
      {
        text: "Delete",
        style: "destructive" as const,
        onPress: () =>
          void remove({ environmentId: props.environmentId, input: { ids: [item.id] } }).then(
            (result) =>
              result._tag === "Success" ? props.onChanged() : report(result, "Could not delete it"),
          ),
      },
      { text: "Close", style: "cancel" as const },
    ];
    Dialog.alert(
      item.title,
      [
        LIBRARY_CATEGORY_NAMES[item.category],
        item.projectTitle,
        dateLabel(item.updatedAt),
        formatBytes(item.sizeBytes),
        item.threadTitle ? `Made in “${item.threadTitle}”` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      actions,
    );
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="gap-3 px-4 pb-10 pt-2"
    >
      <TextInput
        accessibilityLabel="Search the library"
        value={query}
        onChangeText={setQuery}
        placeholder="Search everything you've made"
        placeholderTextColorClassName="accent-foreground-muted"
        className="min-h-10 rounded-xl border border-border px-3 font-sans text-base text-foreground"
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2"
      >
        {[{ id: "all" as const, label: "All" }, ...LIBRARY_CATEGORIES].map((entry) =>
          entry.id !== "all" && counts[entry.id] === 0 ? null : (
            <ListPillButton
              key={entry.id}
              label={`${category === entry.id ? "✓ " : ""}${entry.label} ${counts[entry.id]}`}
              onPress={() => setCategory(entry.id)}
            />
          ),
        )}
        <ListPillButton
          label={largest ? "Largest first" : "Newest first"}
          onPress={() => setLargest((value) => !value)}
        />
      </ScrollView>
      {shown.length === 0 ? (
        <Text textRole="footnote" className="text-foreground-muted">
          {props.report.items.length === 0 ? "Nothing yet." : "Nothing matches."}
        </Text>
      ) : (
        shown.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.title}`}
            onPress={() => onItem(item)}
            className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-2.5 active:opacity-70"
          >
            <View className={cn("size-10 rounded-lg", TILE[item.category])} />
            <View className="min-w-0 flex-1">
              <Text
                textRole="footnote"
                numberOfLines={1}
                className="font-t3-medium text-foreground"
              >
                {item.title}
              </Text>
              <Text textRole="label" numberOfLines={1} className="text-foreground-muted">
                {[
                  LIBRARY_CATEGORY_NAMES[item.category],
                  dateLabel(item.updatedAt),
                  formatBytes(item.sizeBytes),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
          </Pressable>
        ))
      )}
      {props.report.trash.length > 0 ? (
        <View className="gap-2 border-t border-border pt-3">
          <View className="flex-row items-center gap-2">
            <Text textRole="headline" className="min-w-0 flex-1 font-t3-bold text-foreground">
              Recently deleted · {formatBytes(trashBytes)}
            </Text>
            <ListPillButton
              label="Empty now"
              onPress={() =>
                Dialog.alert(
                  "Empty Recently deleted?",
                  `Deletes ${props.report.trash.length} item${props.report.trash.length === 1 ? "" : "s"} for good and frees ${formatBytes(trashBytes)}.`,
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Empty",
                      style: "destructive",
                      onPress: () =>
                        void empty({ environmentId: props.environmentId, input: {} }).then(
                          (result) =>
                            result._tag === "Success"
                              ? props.onChanged()
                              : report(result, "Could not empty it"),
                        ),
                    },
                  ],
                )
              }
            />
          </View>
          <Text textRole="label" className="text-foreground-muted">
            Kept for 30 days, then deleted for good.
          </Text>
          {props.report.trash.map((item) => (
            <View key={item.id} className="flex-row items-center gap-2">
              <Text
                textRole="footnote"
                numberOfLines={1}
                className="min-w-0 flex-1 text-foreground"
              >
                {item.title}
              </Text>
              <ListPillButton
                label="Restore"
                onPress={() =>
                  void restore({
                    environmentId: props.environmentId,
                    input: { ids: [item.id] },
                  }).then((result) =>
                    result._tag === "Success"
                      ? props.onChanged()
                      : report(result, "Could not restore it"),
                  )
                }
              />
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
