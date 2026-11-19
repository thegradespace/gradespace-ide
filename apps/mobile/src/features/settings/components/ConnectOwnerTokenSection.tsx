import { reportAtomCommandResult, settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useGT } from "gt-react-native";
import { useState, useSyncExternalStore } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../../components/ui/AppText";
import { Button } from "../../../components/ui/Button";
import * as Dialog from "../../../components/ui/Dialog";
import { SecretTextInput } from "../../../components/ui/SecretTextInput";
import {
  getAgentAwarenessRegistrationStatus,
  subscribeAgentAwarenessRegistrationStatus,
} from "../../agent-awareness/remoteRegistration";
import {
  removeOwnerToken,
  saveOwnerToken,
  useOwnerCredentialStatus,
} from "../../cloud/ownerCredential";
import { SettingsSection } from "./SettingsSection";

/** Where an owner-mode build takes its relay token: there is no account to sign in to. */
export function ConnectOwnerTokenSection() {
  const gt = useGT();
  const credential = useOwnerCredentialStatus();
  const registration = useSyncExternalStore(
    subscribeAgentAwarenessRegistrationStatus,
    getAgentAwarenessRegistrationStatus,
    () => "unknown" as const,
  );
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const connect = async (value: string) => {
    if (busy || !value.trim()) return;
    setBusy(true);
    setFailure(null);
    const result = await settlePromise(() => saveOwnerToken(value));
    setBusy(false);
    if (result._tag !== "Success") {
      reportAtomCommandResult(result, { label: "owner token save" });
      setFailure(gt("Could not save the token on this device."));
      return;
    }
    if (!result.value) {
      setFailure(gt("That is not an owner token. Paste it again with no spaces."));
      return;
    }
    setDraft("");
  };

  const remove = async () => {
    setBusy(true);
    setFailure(null);
    const result = await settlePromise(removeOwnerToken);
    setBusy(false);
    if (result._tag !== "Success") {
      reportAtomCommandResult(result, { label: "owner token removal" });
      setFailure(gt("Could not remove the token from this device."));
    }
  };

  const confirmRemove = () => {
    Dialog.alert(gt("Remove owner token?"), gt("This device will stop getting agent alerts."), [
      { text: gt("Cancel"), style: "cancel" },
      { text: gt("Remove"), style: "destructive", onPress: () => void remove() },
    ]);
  };

  const failureText = failure ? (
    <Text selectable className="text-xs text-danger-foreground">
      {failure}
    </Text>
  ) : null;

  if (credential === "stored") {
    return (
      <SettingsSection
        title={gt("Owner token")}
        footer={gt("Alerts come from every machine linked with this token.")}
      >
        <View className="gap-3 p-4">
          <Text className="text-base text-foreground">
            {registration === "registered"
              ? gt("Connected", { $context: "this device is registered for agent alerts" })
              : registration === "failed"
                ? gt(
                    "Could not connect. Check your internet connection. If the token is wrong, remove it and paste it again.",
                  )
                : gt("Connecting…")}
          </Text>
          {failureText}
          <View className="flex-row justify-end">
            <Button
              label={gt("Remove token")}
              tone="danger"
              size="compact"
              loading={busy}
              disabled={busy}
              onPress={confirmRemove}
            />
          </View>
        </View>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title={gt("Owner token")}
      footer={gt(
        "Paste the owner token from your {product} relay to get agent alerts on this device. It is stored on this device only.",
        { product: "Gradespace Connect" },
      )}
    >
      <View className="gap-3 p-4">
        <Text className="text-base text-foreground-muted">
          {credential === "loading" ? gt("Checking") : gt("Not connected")}
        </Text>
        <SecretTextInput
          accessibilityLabel={gt("Owner token")}
          placeholder={gt("Paste the owner token")}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={(value) => void connect(value)}
          editable={!busy && credential === "missing"}
        />
        {failureText}
        <View className="flex-row justify-end">
          <Button
            label={gt("Connect", { $context: "verb, saves the owner token on this device" })}
            tone="primary"
            size="compact"
            loading={busy}
            disabled={busy || credential !== "missing" || !draft.trim()}
            onPress={() => void connect(draft)}
          />
        </View>
      </View>
    </SettingsSection>
  );
}
