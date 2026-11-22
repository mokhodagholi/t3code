import { useEnvironmentSessionState } from "../../state/session";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  type DraftId,
  deriveEffectiveComposerModelState,
  useComposerDraftModelState,
} from "../../composerDraftStore";
import { draftModelSelectionApplies } from "../../lib/chatThreadActions";
import {
  type ModelSelection,
  type ProjectId,
  ProviderDriverKind,
  type ScopedThreadRef,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  NO_PROVIDER_MODEL_SELECTION,
  providerInstanceEntriesFor,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { type UnifiedSettings } from "@t3tools/contracts/settings";
import { getComposerPromptInjectionState, getComposerProviderState } from "./composerProviderState";
import { resolveComposerProviderSelection } from "../ChatView.logic";

const NO_PROVIDER_MODELS: ServerProvider["models"] = [];

/**
 * The provider instances the composer offers, which one is selected, and the model and options
 * the draft resolves to on it. The draft store is read first so every derivation follows the only
 * hook here; in the composer body they would straddle its later hooks and lose their cache.
 */
export function useComposerProviderModel(
  input: Omit<Parameters<typeof resolveComposerProviderSelection>[0], "entries"> & {
    readonly providerStatuses: ReadonlyArray<ServerProvider>;
    readonly environmentId?: EnvironmentId;
    readonly settings: UnifiedSettings;
    readonly activeProjectId: ProjectId | null;
    readonly threadRef: ScopedThreadRef | DraftId;
    readonly threadModelSelection: ModelSelection | null | undefined;
    readonly projectModelSelection: ModelSelection | null | undefined;
    readonly promptInjectionState: ReturnType<typeof getComposerPromptInjectionState>;
    readonly threadStarted: boolean;
  },
) {
  const {
    providerStatuses,
    settings,
    activeProjectId,
    threadRef,
    threadModelSelection,
    projectModelSelection,
    promptInjectionState,
    candidateInstanceIds,
    lockedProvider,
    lockedInstanceId,
    threadStarted,
  } = input;
  const draftModelState = useComposerDraftModelState(threadRef);
  const restricted =
    useEnvironmentSessionState(input.environmentId ?? null).data?.allowedDirectories !== undefined;
  const availableProviders = restricted
    ? providerStatuses.filter((provider) => provider.driver === "codex")
    : providerStatuses;
  const providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry> = providerInstanceEntriesFor(
    availableProviders,
    settings,
    activeProjectId,
  );
  const selection = resolveComposerProviderSelection({
    entries: providerInstanceEntries,
    candidateInstanceIds: [
      draftModelSelectionApplies(draftModelState, threadStarted)
        ? draftModelState.activeProvider
        : null,
      ...candidateInstanceIds,
    ],
    lockedProvider: restricted ? null : lockedProvider,
    lockedInstanceId:
      restricted && !availableProviders.some((provider) => provider.instanceId === lockedInstanceId)
        ? undefined
        : lockedInstanceId,
  });
  const selectedInstanceId =
    selection.selectedProviderEntry?.instanceId ?? NO_PROVIDER_MODEL_SELECTION.instanceId;
  const selectedProvider: ProviderDriverKind =
    selection.selectedProviderEntry?.driverKind ?? selection.requestedDriverKind;
  const modelState = deriveEffectiveComposerModelState({
    draft: draftModelState,
    threadStarted,
    providers: availableProviders,
    selectedProvider,
    selectedInstanceId,
    requestedInstanceId: selection.requestedInstanceId,
    threadModelSelection,
    projectModelSelection,
    settings,
  });
  const selectedProviderModels = selection.selectedProviderEntry?.models ?? NO_PROVIDER_MODELS;
  const composerProviderState = getComposerProviderState({
    provider: selectedProvider,
    model: modelState.selectedModel,
    models: selectedProviderModels,
    promptInjectionState,
    modelOptions: modelState.modelOptions?.[selectedInstanceId],
  });
  return {
    providerInstanceEntries,
    ...selection,
    selectedInstanceId,
    selectedProvider,
    selectedProviderModels,
    composerModelOptions: modelState.modelOptions,
    selectedModel: modelState.selectedModel,
    composerProviderState,
  };
}
