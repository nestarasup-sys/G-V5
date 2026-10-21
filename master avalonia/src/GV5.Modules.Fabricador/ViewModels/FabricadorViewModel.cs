using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using System.Diagnostics;
using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Modules.Fabricador.Import;
using GV5.Rendering;
using Avalonia.Threading;
using GV5.Geometry;
using GV5.Modules.Fabricador.Interaction;

namespace GV5.Modules.Fabricador.ViewModels;

public partial class FabricadorViewModel : ObservableObject, IModulePageViewModel, IFlushablePageViewModel, IDisposable
{
    private static readonly TimeSpan AutosaveDelay = TimeSpan.FromMilliseconds(600);
    private readonly IModelDraftRepository _repository;
    private readonly IDataPlatformInitializer _dataInitializer;
    private readonly IModelDraftCheckpointStore? _checkpointStore;
    private readonly IStructuredDiagnosticLogger? _logger;
    private readonly IOperationCorrelationContext? _correlationContext;
    private readonly IFilePicker? _filePicker;
    private readonly ModelSourceImportService? _modelSourceImportService;
    private readonly IAssetStore? _assetStore;
    private readonly IModelDraftContentRepository? _contentRepository;
    private readonly IRenderSceneRenderer? _sceneRenderer;
    private readonly object _previewSync = new();
    private CancellationTokenSource? _previewCancellation;
    private long _previewVersion;
    private ModelDraftContent? _modelContent;
    private ModelDraft? _savedDraft;
    private ModelId? _pendingModelId;
    private Guid? _pendingCheckpointId;
    private CancellationTokenSource? _autosaveCancellation;
    private Task? _autosaveTask;
    private Task? _activeSaveTask;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasImportPreview))]
    [NotifyPropertyChangedFor(nameof(ImportPreviewDimensions))]
    [NotifyPropertyChangedFor(nameof(CanPublishModelSource))]
    [NotifyCanExecuteChangedFor(nameof(PublishModelSourceCommand))]
    private ModelSourceImportPreview? importPreview;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SelectModelSourceCommand))]
    [NotifyCanExecuteChangedFor(nameof(PublishModelSourceCommand))]
    [NotifyPropertyChangedFor(nameof(CanSelectModelSource))]
    [NotifyPropertyChangedFor(nameof(CanPublishModelSource))]
    [NotifyPropertyChangedFor(nameof(CanCancelImport))]
    private bool isImporting;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasImportError))]
    private string? importError;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasImportStatus))]
    private string? importStatus;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSave))]
    [NotifyCanExecuteChangedFor(nameof(PublishModelSourceCommand))]
    [NotifyCanExecuteChangedFor(nameof(SaveCommand))]
    private string modelName = string.Empty;

    [ObservableProperty]
    private RenderedFrame? renderedModelFrame;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(SelectedPartName))]
    [NotifyPropertyChangedFor(nameof(SelectedPartBounds))]
    private ModelPartId? selectedModelPartId;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsSelectTool))]
    [NotifyPropertyChangedFor(nameof(IsPanTool))]
    private FabricatorTool activeTool = FabricatorTool.Select;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasModelRenderError))]
    private string? modelRenderError;

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
    public bool HasImportPreview => ImportPreview is not null;
    public bool HasImportError => !string.IsNullOrWhiteSpace(ImportError);
    public bool HasImportStatus => !string.IsNullOrWhiteSpace(ImportStatus);
    public bool CanCancelImport => !IsImporting;
    public string ImportPreviewDimensions => ImportPreview is { } preview
        ? $"Fonte: {preview.Width} × {preview.Height} px · prévia {preview.PreviewWidth} × {preview.PreviewHeight} px"
        : string.Empty;
    public bool CanSelectModelSource => !IsImporting && _filePicker is not null && _modelSourceImportService is not null;
    public bool CanPublishModelSource => !IsImporting
        && !string.IsNullOrWhiteSpace(ModelName)
        && ImportPreview is { } preview
        && _assetStore is not null
        && _contentRepository is not null
        && _sceneRenderer is not null
        && (!preview.IsPublished || _modelContent?.SourceAssetId != preview.PublishedAssetId);
    public bool HasModelRenderError => !string.IsNullOrWhiteSpace(ModelRenderError);
    public bool IsSelectTool => ActiveTool == FabricatorTool.Select;
    public bool IsPanTool => ActiveTool == FabricatorTool.Pan;
    public string SelectedPartName => _modelContent is null || SelectedModelPartId is not { } id
        ? "Nenhuma peça selecionada"
        : _modelContent.Parts.FirstOrDefault(part => part.Id == id)?.Name ?? "Nenhuma peça selecionada";
    public Rect2D? SelectedPartBounds => _modelContent is null || SelectedModelPartId is not { } id
        ? null
        : ModelDraftHitTester.GetPartBounds(_modelContent, id);
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
        IOperationCorrelationContext? correlationContext = null,
        IFilePicker? filePicker = null,
        ModelSourceImportService? modelSourceImportService = null,
        IAssetStore? assetStore = null,
        IModelDraftContentRepository? contentRepository = null,
        IRenderSceneRenderer? sceneRenderer = null)
    {
        _repository = repository ?? throw new ArgumentNullException(nameof(repository));
        _dataInitializer = dataInitializer ?? throw new ArgumentNullException(nameof(dataInitializer));
        _checkpointStore = checkpointStore;
        _logger = logger;
        _correlationContext = correlationContext;
        _filePicker = filePicker;
        _modelSourceImportService = modelSourceImportService;
        _assetStore = assetStore;
        _contentRepository = contentRepository;
        _sceneRenderer = sceneRenderer;
        RecoveryTask = _checkpointStore is null ? Task.CompletedTask : DiscoverPendingRecoveryAsync();
    }

    partial void OnModelNameChanged(string value)
    {
        PublishModelSourceCommand.NotifyCanExecuteChanged();
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

    [RelayCommand(CanExecute = nameof(CanSelectModelSource))]
    private async Task SelectModelSourceAsync()
    {
        if (_filePicker is null || _modelSourceImportService is null)
        {
            return;
        }

        ImportError = null;
        ImportStatus = null;
        IsImporting = true;
        try
        {
            await using var selected = await _filePicker.PickImageAsync();
            if (selected is null)
            {
                return;
            }

            var result = await _modelSourceImportService.PrepareAsync(selected.Content, selected.MediaType);
            if (result.IsFailure)
            {
                ImportError = result.Error!.Message;
                return;
            }

            var previous = ImportPreview;
            ImportPreview = result.Value;
            if (previous is not null)
            {
                await previous.DisposeAsync();
            }

            ImportStatus = $"Prévia validada · {ImportPreview.Width} × {ImportPreview.Height} · {ImportPreview.MediaType}";
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            ImportError = "Não foi possível abrir ou validar essa folha de imagem.";
        }
        finally
        {
            IsImporting = false;
        }
    }

    [RelayCommand(CanExecute = nameof(CanPublishModelSource))]
    private async Task PublishModelSourceAsync()
    {
        if (ImportPreview is not { } preview || _assetStore is null || _modelSourceImportService is null
            || _contentRepository is null || _sceneRenderer is null)
        {
            return;
        }

        ImportError = null;
        IsImporting = true;
        try
        {
            AssetId assetId;
            if (preview.IsPublished && preview.PublishedAssetId is { } publishedAssetId)
            {
                assetId = publishedAssetId;
            }
            else
            {
                var result = await _modelSourceImportService.PublishAsync(preview, _assetStore);
                if (result.IsFailure)
                {
                    ImportError = result.Error!.Message;
                    return;
                }

                assetId = result.Value.Id;
            }

            if (_savedDraft is null)
            {
                await SaveDraftAsync(cancelPendingAutosave: true);
                if (_activeSaveTask is not null)
                {
                    await _activeSaveTask;
                }
            }

            if (_savedDraft is null)
            {
                ImportError = "Salve o nome do modelo antes de anexar a folha de imagem.";
                return;
            }

            await _dataInitializer.InitializeAsync();
            var loaded = await _contentRepository.GetAsync(_savedDraft.Id);
            var existingContent = loaded.IsSuccess ? loaded.Value : null;
            if (loaded.IsFailure && loaded.Error!.Code != ApplicationErrorCode.NotFound)
            {
                ImportError = loaded.Error.Message;
                return;
            }

            var content = existingContent is null
                ? ModelDraftContent.Restore(
                    ModelDraftContent.CurrentSchemaVersion,
                    _savedDraft.Id,
                    Revision.From(1),
                    null,
                    assetId,
                    preview.Width,
                    preview.Height,
                    [],
                    [])
                : existingContent.SourceAssetId == assetId
                    ? existingContent
                    : existingContent.WithSource(assetId, preview.Width, preview.Height);

            if (!ReferenceEquals(content, existingContent))
            {
                var savedContent = await _contentRepository.SaveAsync(content, existingContent?.Revision);
                if (savedContent.IsFailure)
                {
                    ImportError = savedContent.Error!.Message;
                    return;
                }

                content = savedContent.Value;
            }

            await RenderModelPreviewAsync(content);
            if (HasModelRenderError)
            {
                ImportError = ModelRenderError;
                return;
            }

            _modelContent = content;
            SelectedModelPartId = null;
            OnPropertyChanged(nameof(SelectedPartName));
            OnPropertyChanged(nameof(SelectedPartBounds));
            ImportStatus = $"Modelo carregado · {preview.Width} × {preview.Height} · {assetId}";
            OnPropertyChanged(nameof(CanPublishModelSource));
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            ImportError = "Não foi possível publicar a folha de imagem. A prévia permanece disponível para nova tentativa.";
        }
        finally
        {
            IsImporting = false;
        }
    }

    [RelayCommand]
    private void SetTool(FabricatorTool tool)
    {
        if (Enum.IsDefined(tool))
        {
            ActiveTool = tool;
        }
    }

    public void SelectModelPartAt(Point2D scenePoint)
    {
        SelectedModelPartId = _modelContent is null
            ? null
            : ModelDraftHitTester.HitTest(_modelContent, scenePoint);
    }

    private async Task RenderModelPreviewAsync(ModelDraftContent content)
    {
        if (_sceneRenderer is null)
        {
            return;
        }

        var scene = ModelDraftRenderSceneBuilder.Build(content);
        var request = new CancellationTokenSource();
        CancellationTokenSource? previous;
        long version;
        lock (_previewSync)
        {
            version = checked(++_previewVersion);
            previous = _previewCancellation;
            _previewCancellation = request;
        }
        CancelPreviewSafely(previous);
        RenderedFrame? frame = null;
        try
        {
            frame = await _sceneRenderer.RenderAsync(scene, request.Token).ConfigureAwait(false);
            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                lock (_previewSync)
                {
                    if (version != _previewVersion || request.IsCancellationRequested)
                    {
                        return;
                    }

                    var previousFrame = RenderedModelFrame;
                    RenderedModelFrame = frame;
                    frame = null;
                    previousFrame?.Dispose();
                    ModelRenderError = null;
                }
            });
        }
        catch (OperationCanceledException) when (request.IsCancellationRequested)
        {
            // A newer model revision superseded this preview request.
        }
        catch (Exception exception) when (exception is InvalidOperationException or IOException or ArgumentException)
        {
            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                lock (_previewSync)
                {
                    if (version == _previewVersion && !request.IsCancellationRequested)
                    {
                        ModelRenderError = "Não foi possível compor a prévia do modelo. Verifique os assets e tente novamente.";
                    }
                }
            });
        }
        finally
        {
            frame?.Dispose();
            lock (_previewSync)
            {
                if (ReferenceEquals(_previewCancellation, request))
                {
                    _previewCancellation = null;
                }
            }
            request.Dispose();
        }
    }

    public void Dispose()
    {
        CancellationTokenSource? active;
        RenderedFrame? frame;
        lock (_previewSync)
        {
            _previewVersion = checked(_previewVersion + 1);
            active = _previewCancellation;
            _previewCancellation = null;
            frame = RenderedModelFrame;
            RenderedModelFrame = null;
        }

        CancelPreviewSafely(active);
        frame?.Dispose();
        CancelPendingAutosave();
        var stagedPreview = ImportPreview;
        ImportPreview = null;
        if (stagedPreview is not null)
        {
            _ = stagedPreview.DisposeAsync();
        }
    }

    private static void CancelPreviewSafely(CancellationTokenSource? source)
    {
        if (source is null)
        {
            return;
        }

        try
        {
            source.Cancel();
        }
        catch (ObjectDisposedException)
        {
            // The render completed between publishing the cancellation source and signaling it.
        }
    }

    [RelayCommand]
    private async Task CancelModelSourceImportAsync()
    {
        var preview = ImportPreview;
        ImportPreview = null;
        ImportError = null;
        ImportStatus = null;
        if (preview is not null)
        {
            await preview.DisposeAsync();
        }
    }

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
