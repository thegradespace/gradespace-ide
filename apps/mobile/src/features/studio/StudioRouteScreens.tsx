import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  parseStudioManifest,
  STUDIO_MANIFEST_NAME,
  STUDIO_ROOT,
  type StudioVariant,
  studioSetPaths,
  studioVariantKind,
  withStudioPicked,
  withStudioPickLine,
} from "@t3tools/client-runtime/studio";
import {
  EnvironmentId,
  type ProjectListEntriesResult,
  type ProjectReadFileResult,
  type ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { useRef, useState } from "react";
import { FlatList, Image, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { WebView } from "react-native-webview";

import { LoadingScreen } from "../../components/LoadingScreen";
import { MediaVideoPlayer } from "../../components/MediaVideoPlayer";
import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { ListRow } from "../../components/ui/ListRow";
import { ListSection } from "../../components/ui/ListSection";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { cn } from "../../lib/cn";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { getComposerDraftSnapshot, setComposerDraftText } from "../../state/use-composer-drafts";
import { useThreadCwd } from "../../state/use-selected-thread-worktree";
import { useWorkspaceFileAssetUrlState } from "../files/workspaceFileAssetUrl";

type ThreadStudioRouteProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly threadId: string;
}>;

type ThreadStudioSetRouteProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly threadId: string;
  readonly set: string;
}>;

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

function useStudioThread(params: {
  readonly environmentId: string | string[];
  readonly threadId: string | string[];
}) {
  const ref: ScopedThreadRef = {
    environmentId: EnvironmentId.make(first(params.environmentId)),
    threadId: ThreadId.make(first(params.threadId)),
  };
  return { ref, cwd: useThreadCwd(ref) };
}

function useStudioManifest(ref: ScopedThreadRef, cwd: string | null, setPath: string) {
  const query = useEnvironmentQuery(
    cwd === null
      ? null
      : projectEnvironment.readFile({
          environmentId: ref.environmentId,
          input: { cwd, relativePath: `${setPath}/${STUDIO_MANIFEST_NAME}` },
        }),
  );
  const file = query.data as ProjectReadFileResult | null;
  return {
    contents: file?.contents ?? null,
    manifest: file === null ? null : parseStudioManifest(file.contents),
    error: query.error,
    refresh: query.refresh,
  };
}

/** The project's Studio sets for a chat, newest first, as the desktop Studio panel lists them. */
export function ThreadStudioRouteScreen(props: ThreadStudioRouteProps) {
  const navigation = useNavigation();
  const { ref, cwd } = useStudioThread(props.route.params);
  const entries = useEnvironmentQuery(
    cwd === null
      ? null
      : projectEnvironment.listEntries({
          environmentId: ref.environmentId,
          input: { cwd, directoryPath: STUDIO_ROOT },
        }),
  );
  const listing = entries.data as ProjectListEntriesResult | null;
  const sets = studioSetPaths(listing?.entries ?? []);
  return (
    <>
      <AppBar title="Studio" onBack={() => navigation.goBack()} />
      {listing === null && entries.error === null ? (
        <LoadingScreen message="Loading Studio designs" />
      ) : sets.length === 0 ? (
        <View className="flex-1 items-center justify-center bg-sheet px-6">
          <EmptyState
            title="No Studio designs yet"
            detail={`Designs show here once an agent writes a set to ${STUDIO_ROOT} in this project.`}
          />
        </View>
      ) : (
        <ScreenScrollView contentInsetAdjustmentBehavior="automatic" className="bg-sheet">
          <View className="gap-4 px-4 py-4">
            <ListSection title="Sets">
              {sets.map((setPath) => (
                <StudioSetRow
                  key={setPath}
                  threadRef={ref}
                  cwd={cwd}
                  setPath={setPath}
                  onPress={() =>
                    navigation.navigate("ThreadStudioSet", {
                      environmentId: String(ref.environmentId),
                      threadId: String(ref.threadId),
                      set: setPath.slice(STUDIO_ROOT.length + 1),
                    })
                  }
                />
              ))}
            </ListSection>
          </View>
        </ScreenScrollView>
      )}
    </>
  );
}

function StudioSetRow(props: {
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string | null;
  readonly setPath: string;
  readonly onPress: () => void;
}) {
  const { manifest } = useStudioManifest(props.threadRef, props.cwd, props.setPath);
  const folder = props.setPath.split("/").at(-1) ?? props.setPath;
  const count = manifest?.variants.length ?? 0;
  return (
    <ListRow
      icon="square.on.square"
      label={manifest?.title ?? folder}
      description={manifest ? folder : undefined}
      detail={
        manifest === null
          ? undefined
          : manifest.picked
            ? `Picked ${manifest.picked}`
            : `${count} option${count === 1 ? "" : "s"}`
      }
      onPress={props.onPress}
    />
  );
}

/** Options A/B/C as swipeable pages, with the set's note, recommendation and Pick. */
export function ThreadStudioSetRouteScreen(props: ThreadStudioSetRouteProps) {
  const navigation = useNavigation();
  const { ref, cwd } = useStudioThread(props.route.params);
  const setPath = `${STUDIO_ROOT}/${first(props.route.params.set)}`;
  const { contents, manifest, error, refresh } = useStudioManifest(ref, cwd, setPath);
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const listRef = useRef<FlatList<StudioVariant>>(null);
  const canWrite = useAtomValue(projectEnvironment.writeFile.permissionAtom(ref.environmentId));
  const writeFile = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });

  if (manifest === null || contents === null || cwd === null) {
    return error !== null || (contents !== null && manifest === null) ? (
      <View className="flex-1 bg-sheet">
        <AppBar title="Studio" onBack={() => navigation.goBack()} />
        <View className="flex-1 items-center justify-center px-6">
          <EmptyState
            title="Set unavailable"
            detail={error ?? `${setPath}/${STUDIO_MANIFEST_NAME} is not a valid Studio file.`}
          />
        </View>
      </View>
    ) : (
      <View className="flex-1 bg-sheet">
        <AppBar title="Studio" onBack={() => navigation.goBack()} />
        <LoadingScreen message="Loading designs" />
      </View>
    );
  }

  const togglePick = async (variant: StudioVariant) => {
    const picked = manifest.picked === variant.id ? null : variant;
    const next = withStudioPicked(contents, picked?.id ?? null);
    if (next === null || saving) return;
    setSaving(true);
    const result = await writeFile({
      environmentId: ref.environmentId,
      input: { cwd, relativePath: `${setPath}/${STUDIO_MANIFEST_NAME}`, contents: next },
    }).finally(() => setSaving(false));
    if (result._tag !== "Success") {
      if (!isAtomCommandInterrupted(result)) {
        const cause = squashAtomCommandFailure(result);
        Dialog.alert("Could not save your pick", cause instanceof Error ? cause.message : "");
      }
      return;
    }
    refresh();
    const draftKey = scopedThreadKey(ref.environmentId, ref.threadId);
    setComposerDraftText(
      draftKey,
      withStudioPickLine(getComposerDraftSnapshot(draftKey).text, manifest, setPath, picked),
    );
  };

  const openFullScreen = (variant: StudioVariant) =>
    navigation.navigate("ThreadFile", {
      environmentId: String(ref.environmentId),
      threadId: String(ref.threadId),
      path: `${setPath}/${variant.file}`.split("/").filter((segment) => segment.length > 0),
    });

  return (
    <View className="flex-1 bg-sheet">
      <AppBar title={manifest.title} onBack={() => navigation.goBack()} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        className="max-h-14 grow-0"
        contentContainerClassName="items-center gap-2 px-4 py-2"
      >
        {manifest.variants.map((variant, position) => (
          <Pressable
            key={variant.id}
            accessibilityRole="tab"
            accessibilityLabel={`Option ${variant.id}`}
            accessibilityState={{ selected: position === index }}
            onPress={() => {
              setIndex(position);
              listRef.current?.scrollToIndex({ index: position, animated: true });
            }}
            className={cn(
              "min-h-8 flex-row items-center gap-1 rounded-2xl px-3",
              position === index ? "bg-primary" : "bg-subtle",
            )}
          >
            <Text
              textRole="footnote"
              className={cn(
                "font-t3-bold",
                position === index ? "text-primary-foreground" : "text-foreground",
              )}
            >
              {variant.id}
              {manifest.picked === variant.id ? " ✓" : ""}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <FlatList
        ref={listRef}
        data={manifest.variants}
        keyExtractor={(variant) => variant.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, position) => ({
          length: width,
          offset: width * position,
          index: position,
        })}
        onMomentumScrollEnd={(event) =>
          setIndex(Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width)))
        }
        renderItem={({ item: variant, index: position }) => (
          <View style={{ width }} className="flex-1 gap-3 px-4 pb-6">
            <View className="flex-1 overflow-hidden rounded-2xl border border-border bg-card">
              <StudioVariantPreview
                threadRef={ref}
                cwd={cwd}
                path={`${setPath}/${variant.file}`}
                title={variant.title}
                visible={position === index}
              />
            </View>
            <View className="gap-1">
              <View className="flex-row flex-wrap items-center gap-2">
                <Text textRole="headline" className="font-t3-bold text-foreground">
                  {variant.id}. {variant.title}
                </Text>
                {manifest.recommended === variant.id ? <Badge label="Recommended" /> : null}
                {manifest.picked === variant.id ? <Badge label="Picked" strong /> : null}
              </View>
              {variant.note ? (
                <Text textRole="footnote" className="text-foreground-muted">
                  {variant.note}
                </Text>
              ) : null}
            </View>
            <View className="flex-row gap-2">
              <Button
                label={manifest.picked === variant.id ? "Picked" : "Pick"}
                icon={manifest.picked === variant.id ? "checkmark" : undefined}
                tone={manifest.picked === variant.id ? "primary" : "secondary"}
                accessibilityHint={
                  manifest.picked === variant.id ? "Clears the pick" : "Saves this option as picked"
                }
                loading={saving}
                disabled={!canWrite}
                onPress={() => void togglePick(variant)}
              />
              <Button
                label="Full screen"
                icon="arrow.up.left.and.arrow.down.right"
                tone="text"
                onPress={() => openFullScreen(variant)}
              />
            </View>
          </View>
        )}
      />
    </View>
  );
}

function Badge(props: { readonly label: string; readonly strong?: boolean }) {
  return (
    <View className={cn("rounded-full px-2 py-0.5", props.strong ? "bg-primary" : "bg-subtle")}>
      <Text
        textRole="caption"
        className={cn(
          "font-t3-bold",
          props.strong ? "text-primary-foreground" : "text-foreground-muted",
        )}
      >
        {props.label}
      </Text>
    </View>
  );
}

/** HTML loads from the same workspace-file route the desktop frames, which sends its sandbox CSP. */
function StudioVariantPreview(props: {
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string;
  readonly path: string;
  readonly title: string;
  readonly visible: boolean;
}) {
  const asset = useWorkspaceFileAssetUrlState({
    cwd: props.cwd,
    environmentId: props.threadRef.environmentId,
    relativePath: props.path,
    threadId: props.threadRef.threadId,
  });
  const kind = studioVariantKind(props.path);
  if (asset._tag === "Failure") {
    return (
      <View className="flex-1 items-center justify-center px-6">
        <EmptyState title="Preview unavailable" detail="This option's file could not be loaded." />
      </View>
    );
  }
  const uri = asset._tag === "Success" ? asset.url : null;
  if (kind === "video") {
    return (
      <View className="flex-1 items-center justify-center p-2">
        <MediaVideoPlayer
          uri={uri}
          resolvePlaybackUri={asset.refresh}
          name={props.title}
          thumbnailKey={`studio:${props.path}`}
          paused={!props.visible}
          fitToVideo
        />
      </View>
    );
  }
  if (uri === null) return <LoadingScreen message="Loading preview" embedded />;
  if (kind === "image") {
    return (
      <Image
        accessibilityLabel={props.title}
        source={{ uri }}
        resizeMode="contain"
        className="h-full w-full"
      />
    );
  }
  if (kind === "html" || kind === "pdf") {
    return (
      <WebView
        source={{ uri }}
        originWhitelist={["*"]}
        setSupportMultipleWindows={false}
        javaScriptCanOpenWindowsAutomatically={false}
        allowsBackForwardNavigationGestures={false}
        style={{ flex: 1, backgroundColor: "transparent" }}
      />
    );
  }
  return (
    <View className="flex-1 items-center justify-center px-6">
      <EmptyState title="No preview" detail="Open it full screen to view this file." />
    </View>
  );
}
