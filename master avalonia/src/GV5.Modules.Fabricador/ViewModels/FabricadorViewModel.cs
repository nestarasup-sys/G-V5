using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using System.Diagnostics;
using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;

namespace GV5.Modules.Fabricador.ViewModels;

public partial class FabricadorViewModel : ObservableObject, IModulePageViewModel, IFlushablePageViewModel
{
    private static readonly TimeSpan AutosaveDelay = TimeSpan.FromMilliseconds(600);
    private readonly IModelDraftRepository _repository;
    private readonly IDataPlatformInitializer _dataInitializer;
    private readonly IModelDraftCheckpointStore? _checkpointStore;
    private readonly IStructuredDiagnosticLogger? _logger;
    private readonly IOperationCorrelationContext? _correlationContext;
    private ModelDraft? _savedDraft;
    private ModelId? _pendingModelId;
    private Guid? _pendingCheckpointId;
    private CancellationTokenSource? _autosaveCancellation;
    private Task? _autosaveTask;
    private Task? _activeSaveTask;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSave))]
    [NotifyCanExecuteChangedFor(nameof(SaveCommand))]
    private string modelName = string.Empty;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSave))]
    [NotifyPropertyChangedFor(nameof(CanEdit))]
    [NotifyCanExecuteChangedFor(nameof(SaveCommand))]
    [NotifyCanExecuteChangedFor(nameof(RestoreCheckpointCommand))]
    [NotifyCanExecuteChangedFor(nameof(DiscardCheckpointCommand))]
    private bool isSaving;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasPendingRecovery))]
    [NotifyPropertyChangedFor(nameof(CanSave))]
    [NotifyPropertyChangedFor(nameof(CanEdit))]
    [NotifyCanExecuteChangedFor(nameof(SaveCommand))]
    [NotifyCanExecuteChangedFor(nameof(RestoreCheckpointCommand))]
    [NotifyCanExecuteChangedFor(nameof(DiscardCheckpointCommand))]
    private ModelDraftCheckpoint? pendingRecoveryCheckpoint;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasRecoveryMessage))]
    private string? recoveryMessage;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSave))]
    [NotifyPropertyChangedFor(nameof(CanEdit))]
    [NotifyCanExecuteChangedFor(nameof(SaveCommand))]
    private bool isCheckingRecovery;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(SaveStateLabel))]
    private PersistenceState saveState = PersistenceState.Dirty;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasSaveError))]
    private string? saveError;

    public bool CanSave => !IsSaving && !IsCheckingRecovery && !HasPendingRecovery && !string.IsNullOrWhiteSpace(ModelName);
    public bool CanEdit => !IsSaving && !IsCheckingRecovery && !HasPendingRecovery;
    public bool HasSaveError => !string.IsNullOrWhiteSpace(SaveError);
    public bool HasPendingRecovery => PendingRecoveryCheckpoint is not null;
    public bool HasRecoveryMessage => !string.IsNullOrWhiteSpace(RecoveryMessage);
    public Task RecoveryTask { get; }

    public string SaveStateLabel => SaveState switch
    {
        PersistenceState.Saved => "Salvo",
        PersistenceState.Dirty => "Alterações não salvas",
        PersistenceState.Saving => "Salvando…",
        PersistenceState.Error => "Erro ao salvar",
        _ => "Estado desconhecido"
    };

    public string Status { get; } = "Crie um rascunho de modelo. As alterações só aparecem como salvas após a confirmação do SQLite.";

    public FabricadorViewModel(
        IModelDraftRepository repository,
        IDataPlatformInitializer dataInitializer,
        IModelDraftCheckpointStore? checkpointStore = null,
        IStructuredDiagnosticLogger? logger = null,
        IOperationCorrelationContext? correlationContext = null)
    {
        _repository = repository ?? throw new ArgumentNullException(nameof(repository));
        _dataInitializer = dataInitializer ?? throw new ArgumentNullException(nameof(dataInitializer));
        _checkpointStore = checkpointStore;
        _logger = logger;
        _correlationContext = correlationContext;
        RecoveryTask = _checkpointStore is null ? Task.CompletedTask : DiscoverPendingRecoveryAsync();
    }

    partial void OnModelNameChanged(string value)
    {
        if (IsSaving)
        {
            return;
        }

        SaveError = null;
        if (_savedDraft is not null && string.Equals(value.Trim(), _savedDraft.Name, StringComparison.Ordinal))
        {
            CancelPendingAutosave();
            SaveState = PersistenceState.Saved;
            return;
        }

        SaveState = PersistenceState.Dirty;
        ScheduleAutosave();
    }

    [RelayCommand(CanExecute = nameof(CanSave))]
    private Task SaveAsync() => SaveDraftAsync(cancelPendingAutosave: true);

    public async Task<bool> FlushPendingChangesAsync(CancellationToken cancellationToken = default)
    {
        var pendingAutosave = _autosaveTask;
        CancelPendingAutosave();
        if (pendingAutosave is not null)
        {
            await pendingAutosave.WaitAsync(cancellationToken);
        }

        if (_activeSaveTask is not null)
        {
            await _activeSaveTask.WaitAsync(cancellationToken);
        }

        var hasPendingChanges = _savedDraft is null
            ? !string.IsNullOrWhiteSpace(ModelName)
            : !string.Equals(ModelName.Trim(), _savedDraft.Name, StringComparison.Ordinal);
        if (!hasPendingChanges)
        {
            return true;
        }

        if (!CanSave)
        {
            return false;
        }

        await SaveDraftAsync(cancelPendingAutosave: true).WaitAsync(cancellationToken);
        return _savedDraft is not null &&
               string.Equals(ModelName.Trim(), _savedDraft.Name, StringComparison.Ordinal) &&
               SaveState == PersistenceState.Saved;
    }

    private Task SaveDraftAsync(bool cancelPendingAutosave)
    {
        if (cancelPendingAutosave)
        {
            CancelPendingAutosave();
        }

        if (IsSaving)
        {
            return _activeSaveTask ?? Task.CompletedTask;
        }

        if (!CanSave)
        {
            return Task.CompletedTask;
        }

        _activeSaveTask = SaveDraftCoreAsync();
        return _activeSaveTask;
    }

    private async Task SaveDraftCoreAsync()
    {
        using var correlationScope = _correlationContext?.BeginScope();
        var stopwatch = Stopwatch.StartNew();
        DiagnosticErrorCode? diagnosticErrorCode = null;
        IsSaving = true;
        SaveState = PersistenceState.Saving;
        SaveError = null;
        try
        {
            await _dataInitializer.InitializeAsync();
            var now = Math.Max(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), _savedDraft?.UpdatedUtcMs ?? 0);
            var modelId = _savedDraft?.Id ?? (_pendingModelId ??= ModelId.New());
            var checkpoint = _checkpointStore is null
                ? null
                : ModelDraftCheckpoint.Create(
                    _pendingCheckpointId ??= Guid.NewGuid(),
                    modelId,
                    _savedDraft?.Revision,
                    ModelName,
                    now);
            if (checkpoint is not null)
            {
                await _checkpointStore!.WriteAsync(checkpoint);
            }

            var draft = _savedDraft is null
                ? ModelDraft.Create(modelId, ModelName, now)
                : _savedDraft.Rename(ModelName, now);

            var result = _savedDraft is null
                ? await _repository.CreateAsync(draft)
                : await _repository.UpdateAsync(draft, _savedDraft.Revision);

            if (result.IsFailure)
            {
                SaveError = result.Error!.Message;
                diagnosticErrorCode = result.Error.Code == ApplicationErrorCode.Conflict
                    ? DiagnosticErrorCode.RevisionConflict
                    : DiagnosticErrorCode.StorageFailure;
                SaveState = PersistenceState.Error;
                return;
            }

            _savedDraft = result.Value;
            _pendingModelId = null;
            ModelName = _savedDraft.Name;
            if (checkpoint is not null)
            {
                await _checkpointStore!.CompleteAsync(checkpoint.CheckpointId);
                _pendingCheckpointId = null;
            }

            SaveState = PersistenceState.Saved;
        }
        catch (Exception)
        {
            SaveError = "Não foi possível gravar o rascunho. Verifique o acesso à pasta de dados e tente novamente.";
            diagnosticErrorCode = DiagnosticErrorCode.StorageFailure;
            SaveState = PersistenceState.Error;
        }
        finally
        {
            IsSaving = false;
            _activeSaveTask = null;
            if (_logger is not null)
            {
                await _logger.WriteAsync(
                    SaveState == PersistenceState.Saved ? DiagnosticEventCode.ModelDraftSaveCompleted : DiagnosticEventCode.ModelDraftSaveFailed,
                    SaveState == PersistenceState.Saved ? DiagnosticOutcome.Success : DiagnosticOutcome.Failure,
                    diagnosticErrorCode,
                    stopwatch.ElapsedMilliseconds,
                    CancellationToken.None);
            }
        }
    }

    private void ScheduleAutosave()
    {
        CancelPendingAutosave();
        if (!CanSave)
        {
            return;
        }

        var cancellation = new CancellationTokenSource();
        _autosaveCancellation = cancellation;
        _autosaveTask = RunAutosaveAfterDelayAsync(cancellation.Token);
    }

    private async Task RunAutosaveAfterDelayAsync(CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(AutosaveDelay, cancellationToken);
            await SaveDraftAsync(cancelPendingAutosave: false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // A later keystroke or an explicit flush owns the newest snapshot.
        }
    }

    private void CancelPendingAutosave()
    {
        var cancellation = _autosaveCancellation;
        _autosaveCancellation = null;
        _autosaveTask = null;
        if (cancellation is null)
        {
            return;
        }

        cancellation.Cancel();
        cancellation.Dispose();
    }

    [RelayCommand(CanExecute = nameof(CanRecoverCheckpoint))]
    private async Task RestoreCheckpointAsync()
    {
        using var correlationScope = _correlationContext?.BeginScope();
        var stopwatch = Stopwatch.StartNew();
        var checkpoint = PendingRecoveryCheckpoint;
        if (checkpoint is null || _checkpointStore is null)
        {
            return;
        }

        IsSaving = true;
        SaveState = PersistenceState.Saving;
        RecoveryMessage = null;
        try
        {
            await _dataInitializer.InitializeAsync();
            var currentResult = await _repository.GetAsync(checkpoint.ModelId);
            ModelDraft? restoredDraft;
            if (currentResult.IsFailure && currentResult.Error?.Code == ApplicationErrorCode.NotFound)
            {
                if (checkpoint.ExpectedRevision is not null)
                {
                    RecoveryMessage = "O modelo associado ao checkpoint não existe mais. O checkpoint foi preservado para você decidir.";
                    SaveState = PersistenceState.Error;
                    await LogDiagnosticAsync(DiagnosticEventCode.DraftRecoveryConflict, DiagnosticOutcome.Warning, DiagnosticErrorCode.RevisionConflict, stopwatch.ElapsedMilliseconds);
                    return;
                }

                var candidate = ModelDraft.Create(checkpoint.ModelId, checkpoint.Name, checkpoint.CreatedUtcMs);
                var createResult = await _repository.CreateAsync(candidate);
                if (createResult.IsFailure)
                {
                    RecoveryMessage = createResult.Error!.Message;
                    SaveState = PersistenceState.Error;
                    return;
                }

                restoredDraft = createResult.Value;
            }
            else if (currentResult.IsFailure)
            {
                RecoveryMessage = currentResult.Error!.Message;
                SaveState = PersistenceState.Error;
                return;
            }
            else
            {
                var current = currentResult.Value;
                if (checkpoint.ExpectedRevision is null)
                {
                    if (!string.Equals(current.Name, checkpoint.Name, StringComparison.Ordinal))
                    {
                        RecoveryMessage = "Já existe uma versão diferente com o mesmo ID. O checkpoint foi preservado sem sobrescrever os dados.";
                        SaveState = PersistenceState.Error;
                        await LogDiagnosticAsync(DiagnosticEventCode.DraftRecoveryConflict, DiagnosticOutcome.Warning, DiagnosticErrorCode.RevisionConflict, stopwatch.ElapsedMilliseconds);
                        return;
                    }

                    restoredDraft = current;
                }
                else if (current.Revision == checkpoint.ExpectedRevision.Value)
                {
                    var candidate = current.Rename(
                        checkpoint.Name,
                        Math.Max(checkpoint.CreatedUtcMs, current.UpdatedUtcMs));
                    var updateResult = await _repository.UpdateAsync(candidate, checkpoint.ExpectedRevision.Value);
                    if (updateResult.IsFailure)
                    {
                        RecoveryMessage = updateResult.Error!.Message;
                        SaveState = PersistenceState.Error;
                        return;
                    }

                    restoredDraft = updateResult.Value;
                }
                else if (current.Revision.Value > checkpoint.ExpectedRevision.Value.Value &&
                         string.Equals(current.Name, checkpoint.Name, StringComparison.Ordinal))
                {
                    // The model commit completed before the application crashed while cleaning the journal.
                    restoredDraft = current;
                }
                else
                {
                    RecoveryMessage = "O modelo recebeu uma revisão mais nova. O checkpoint antigo foi preservado e não sobrescreveu a versão atual.";
                    SaveState = PersistenceState.Error;
                    await LogDiagnosticAsync(DiagnosticEventCode.DraftRecoveryConflict, DiagnosticOutcome.Warning, DiagnosticErrorCode.RevisionConflict, stopwatch.ElapsedMilliseconds);
                    return;
                }
            }

            await _checkpointStore.CompleteAsync(checkpoint.CheckpointId);
            _savedDraft = restoredDraft;
            _pendingModelId = null;
            _pendingCheckpointId = null;
            ModelName = restoredDraft.Name;
            SaveState = PersistenceState.Saved;
            SaveError = null;
            await LogDiagnosticAsync(DiagnosticEventCode.DraftRecoveryCompleted, DiagnosticOutcome.Success, durationMilliseconds: stopwatch.ElapsedMilliseconds);
            await LoadNextCheckpointAsync();
        }
        catch (Exception)
        {
            RecoveryMessage = "Não foi possível validar ou recuperar este checkpoint. Ele foi mantido para uma nova tentativa.";
            SaveState = PersistenceState.Error;
            await LogDiagnosticAsync(DiagnosticEventCode.DraftRecoveryConflict, DiagnosticOutcome.Failure, DiagnosticErrorCode.StorageFailure, stopwatch.ElapsedMilliseconds);
        }
        finally
        {
            IsSaving = false;
        }
    }

    [RelayCommand(CanExecute = nameof(CanRecoverCheckpoint))]
    private async Task DiscardCheckpointAsync()
    {
        var checkpoint = PendingRecoveryCheckpoint;
        if (checkpoint is null || _checkpointStore is null)
        {
            return;
        }

        try
        {
            await _checkpointStore.CompleteAsync(checkpoint.CheckpointId);
            RecoveryMessage = "Checkpoint descartado. O rascunho confirmado permaneceu intacto.";
            await LogDiagnosticAsync(DiagnosticEventCode.DraftCheckpointDiscarded, DiagnosticOutcome.Success);
            await LoadNextCheckpointAsync();
        }
        catch (Exception)
        {
            RecoveryMessage = "Não foi possível descartar o checkpoint; ele permanece armazenado.";
        }
    }

    private bool CanRecoverCheckpoint() => !IsSaving && !IsCheckingRecovery && HasPendingRecovery;

    private async Task DiscoverPendingRecoveryAsync()
    {
        IsCheckingRecovery = true;
        try
        {
            await _dataInitializer.InitializeAsync();
            await LoadNextCheckpointAsync();
            if (HasPendingRecovery)
            {
                await LogDiagnosticAsync(DiagnosticEventCode.DraftRecoveryAvailable, DiagnosticOutcome.Warning);
            }
        }
        catch (Exception)
        {
            RecoveryMessage = "Não foi possível verificar checkpoints de recuperação. Os dados confirmados não foram alterados.";
        }
        finally
        {
            IsCheckingRecovery = false;
        }
    }

    private async Task LoadNextCheckpointAsync()
    {
        if (_checkpointStore is null)
        {
            PendingRecoveryCheckpoint = null;
            return;
        }

        var pending = await _checkpointStore.GetPendingAsync();
        PendingRecoveryCheckpoint = pending.FirstOrDefault();
    }

    private Task LogDiagnosticAsync(
        DiagnosticEventCode eventCode,
        DiagnosticOutcome outcome,
        DiagnosticErrorCode? errorCode = null,
        long? durationMilliseconds = null) =>
        _logger?.WriteAsync(eventCode, outcome, errorCode, durationMilliseconds, CancellationToken.None) ?? Task.CompletedTask;
}
