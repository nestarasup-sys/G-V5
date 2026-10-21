using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using System.Collections.Immutable;
using System.Diagnostics;
using GV5.Application.Contracts;
using GV5.Application.Services;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Modules.Fabricador.Import;
using GV5.Rendering;
using Avalonia.Threading;
using GV5.Geometry;
using GV5.Modules.Fabricador.Interaction;
using System.Globalization;

namespace GV5.Modules.Fabricador.ViewModels;

public partial class FabricadorViewModel : ObservableObject, IModulePageViewModel, IFlushablePageViewModel, IDisposable
{
    private readonly TimeSpan _autosaveDelay;
    private const int HistoryLimit = 50;
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
    private readonly PublishModelRevisionService? _publishModelRevisionService;
    private readonly object _previewSync = new();
    private CancellationTokenSource? _previewCancellation;
    private CancellationTokenSource? _modelImportCancellation;
    private long _previewVersion;
    private ModelDraftContent? _modelContent;
    private ModelDraftContent? _savedModelContent;
    private bool _isModelContentDirty;
    private ActiveModelTransformGesture? _activeTransformGesture;
    private readonly List<IModelDraftCommand> _undoStack = [];
    private readonly List<IModelDraftCommand> _redoStack = [];
    private ModelDraft? _savedDraft;
    private ModelId? _pendingModelId;
    private Guid? _pendingCheckpointId;
    private CancellationTokenSource? _autosaveCancellation;
    private Task? _autosaveTask;
    private Task? _activeSaveTask;
    private RigPartOption? _selectedRigParent;
    private RigPartOption? _selectedRigChild;
    private RigJointItem? _selectedRigJoint;
    private string _rigParentAnchorX = "0";
    private string _rigParentAnchorY = "0";
    private string _rigChildAnchorX = "0";
    private string _rigChildAnchorY = "0";
    private string? _rigError;

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
    [NotifyPropertyChangedFor(nameof(CanPublishRevision))]
    [NotifyCanExecuteChangedFor(nameof(PublishModelRevisionCommand))]
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
    [NotifyPropertyChangedFor(nameof(CanPublishRevision))]
    [NotifyCanExecuteChangedFor(nameof(PublishModelSourceCommand))]
    [NotifyCanExecuteChangedFor(nameof(PublishModelRevisionCommand))]
    [NotifyCanExecuteChangedFor(nameof(SaveCommand))]
    private string modelName = string.Empty;

    [ObservableProperty]
    private RenderedFrame? renderedModelFrame;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(SelectedPartName))]
    [NotifyPropertyChangedFor(nameof(SelectedPartBounds))]
    [NotifyPropertyChangedFor(nameof(SelectedPartPivot))]
    [NotifyPropertyChangedFor(nameof(PartLayers))]
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
    [NotifyPropertyChangedFor(nameof(CanEditRig))]
    [NotifyPropertyChangedFor(nameof(PartLayers))]
    [NotifyCanExecuteChangedFor(nameof(SaveCommand))]
    [NotifyCanExecuteChangedFor(nameof(RestoreCheckpointCommand))]
    [NotifyCanExecuteChangedFor(nameof(DiscardCheckpointCommand))]
    [NotifyPropertyChangedFor(nameof(CanUndo))]
    [NotifyPropertyChangedFor(nameof(CanRedo))]
    [NotifyCanExecuteChangedFor(nameof(UndoCommand))]
    [NotifyCanExecuteChangedFor(nameof(RedoCommand))]
    [NotifyPropertyChangedFor(nameof(CanPublishRevision))]
    [NotifyCanExecuteChangedFor(nameof(PublishModelRevisionCommand))]
    private bool isSaving;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasPendingRecovery))]
    [NotifyPropertyChangedFor(nameof(CanSave))]
    [NotifyPropertyChangedFor(nameof(CanEdit))]
    [NotifyPropertyChangedFor(nameof(CanEditRig))]
    [NotifyPropertyChangedFor(nameof(PartLayers))]
    [NotifyCanExecuteChangedFor(nameof(SaveCommand))]
    [NotifyCanExecuteChangedFor(nameof(RestoreCheckpointCommand))]
    [NotifyCanExecuteChangedFor(nameof(DiscardCheckpointCommand))]
    [NotifyPropertyChangedFor(nameof(CanUndo))]
    [NotifyPropertyChangedFor(nameof(CanRedo))]
    [NotifyCanExecuteChangedFor(nameof(UndoCommand))]
    [NotifyCanExecuteChangedFor(nameof(RedoCommand))]
    [NotifyPropertyChangedFor(nameof(CanPublishRevision))]
    [NotifyCanExecuteChangedFor(nameof(PublishModelRevisionCommand))]
    private ModelDraftCheckpoint? pendingRecoveryCheckpoint;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasRecoveryMessage))]
    private string? recoveryMessage;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSave))]
    [NotifyPropertyChangedFor(nameof(CanEdit))]
    [NotifyPropertyChangedFor(nameof(CanEditRig))]
    [NotifyPropertyChangedFor(nameof(PartLayers))]
    [NotifyCanExecuteChangedFor(nameof(SaveCommand))]
    [NotifyPropertyChangedFor(nameof(CanUndo))]
    [NotifyPropertyChangedFor(nameof(CanRedo))]
    [NotifyCanExecuteChangedFor(nameof(UndoCommand))]
    [NotifyCanExecuteChangedFor(nameof(RedoCommand))]
    [NotifyPropertyChangedFor(nameof(CanPublishRevision))]
    [NotifyCanExecuteChangedFor(nameof(PublishModelRevisionCommand))]
    private bool isCheckingRecovery;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(SaveStateLabel))]
    private PersistenceState saveState = PersistenceState.Dirty;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasSaveError))]
    private string? saveError;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasPublishError))]
    private string? publishError;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasPublishStatus))]
    private string? publishStatus;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanPublishRevision))]
    [NotifyPropertyChangedFor(nameof(CanSave))]
    [NotifyPropertyChangedFor(nameof(CanEdit))]
    [NotifyPropertyChangedFor(nameof(CanEditRig))]
    [NotifyPropertyChangedFor(nameof(PublishRevisionButtonLabel))]
    [NotifyCanExecuteChangedFor(nameof(PublishModelRevisionCommand))]
    [NotifyCanExecuteChangedFor(nameof(SaveCommand))]
    private bool isPublishingRevision;

    public bool CanSave => !IsSaving && !IsPublishingRevision && !IsCheckingRecovery && !HasPendingRecovery
        && !string.IsNullOrWhiteSpace(ModelName) && HasPendingChanges;
    public bool CanEdit => !IsSaving && !IsPublishingRevision && !IsCheckingRecovery && !HasPendingRecovery;
    public bool CanPublishRevision => _publishModelRevisionService is not null && _savedDraft is not null
        && _modelContent is not null && !IsPublishingRevision && !IsSaving && !IsCheckingRecovery && !HasPendingRecovery;
    public string PublishRevisionButtonLabel => IsPublishingRevision ? "Publicando…" : "Publicar versão";
    public bool HasSaveError => !string.IsNullOrWhiteSpace(SaveError);
    public bool HasPublishError => !string.IsNullOrWhiteSpace(PublishError);
    public bool HasPublishStatus => !string.IsNullOrWhiteSpace(PublishStatus);
    public bool HasImportPreview => ImportPreview is not null;
    public bool HasImportError => !string.IsNullOrWhiteSpace(ImportError);
    public bool HasImportStatus => !string.IsNullOrWhiteSpace(ImportStatus);
    public bool CanCancelImport => _modelImportCancellation is not null || (!IsImporting && ImportPreview is not null);
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
    public Point2D? SelectedPartPivot => _modelContent is null || SelectedModelPartId is not { } id
        ? null
        : ModelDraftHitTester.GetPartPivot(_modelContent, id);
    public IReadOnlyList<ModelPartLayerItem> PartLayers
    {
        get
        {
            if (_modelContent is null)
            {
                return [];
            }

            var partsById = _modelContent.Parts.ToDictionary(part => part.Id);
            return _modelContent.LayerOrder
                .Select((id, index) => (id, index))
                .Reverse()
                .Select(item =>
                {
                    var part = partsById[item.id];
                    return new ModelPartLayerItem(
                        part.Id,
                        part.Name,
                        item.index + 1,
                        $"Camada {item.index + 1} · {(part.IsVisible ? "Visível" : "Oculta")}",
                        part.IsVisible,
                        SelectedModelPartId == part.Id,
                        part.IsVisible ? "Ocultar" : "Mostrar",
                        CanEdit,
                        CanEdit && item.index < _modelContent.LayerOrder.Length - 1,
                        CanEdit && item.index > 0);
                })
                .ToArray();
        }
    }
    public bool HasModelParts => _modelContent is { Parts.IsDefaultOrEmpty: false };
    public bool CanEditRig => CanEdit && _modelContent is { Parts.Length: >= 2 };
    public bool HasRigEditingParts => _modelContent is { Parts.Length: >= 2 };
    public bool NeedsRigParts => !HasRigEditingParts;
    public IReadOnlyList<RigPartOption> RigPartOptions => _modelContent?.Parts
        .Select(part => new RigPartOption(part.Id, part.Name)).ToArray() ?? [];
    public IReadOnlyList<RigJointItem> RigJointItems
    {
        get
        {
            if (_modelContent is null) return [];
            var names = _modelContent.Parts.ToDictionary(part => TransformNodeId.From(part.Id.Value), part => part.Name);
            return _modelContent.RigJoints.Select(joint => new RigJointItem(
                joint,
                $"{names[joint.ParentPartId]} → {names[joint.ChildPartId]}",
                joint.Mode == RigJointMode.Fixed ? "Fixa" : "Livre")).ToArray();
        }
    }
    public RigPartOption? SelectedRigParent { get => _selectedRigParent; set => SetProperty(ref _selectedRigParent, value); }
    public RigPartOption? SelectedRigChild { get => _selectedRigChild; set => SetProperty(ref _selectedRigChild, value); }
    public RigJointItem? SelectedRigJoint
    {
        get => _selectedRigJoint;
        set
        {
            if (!SetProperty(ref _selectedRigJoint, value)) return;
            OnPropertyChanged(nameof(CanEditSelectedRigJoint));
            if (value is not null)
            {
                RigParentAnchorX = Format(value.Joint.ParentAnchor.X);
                RigParentAnchorY = Format(value.Joint.ParentAnchor.Y);
                RigChildAnchorX = Format(value.Joint.ChildAnchor.X);
                RigChildAnchorY = Format(value.Joint.ChildAnchor.Y);
            }
            OnPropertyChanged(nameof(SelectedRigJointModeLabel));
        }
    }
    public string RigParentAnchorX { get => _rigParentAnchorX; set => SetProperty(ref _rigParentAnchorX, value); }
    public string RigParentAnchorY { get => _rigParentAnchorY; set => SetProperty(ref _rigParentAnchorY, value); }
    public string RigChildAnchorX { get => _rigChildAnchorX; set => SetProperty(ref _rigChildAnchorX, value); }
    public string RigChildAnchorY { get => _rigChildAnchorY; set => SetProperty(ref _rigChildAnchorY, value); }
    public string? RigError
    {
        get => _rigError;
        private set
        {
            if (SetProperty(ref _rigError, value)) OnPropertyChanged(nameof(HasRigError));
        }
    }
    public bool HasRigError => !string.IsNullOrWhiteSpace(RigError);
    public bool CanEditSelectedRigJoint => CanEditRig && SelectedRigJoint is not null;
    public string SelectedRigJointModeLabel => SelectedRigJoint?.Joint.Mode == RigJointMode.Fixed ? "Tornar livre" : "Fixar junta";
    public int UndoCount => _undoStack.Count;
    public int RedoCount => _redoStack.Count;
    public bool CanUndo => CanEdit && _activeTransformGesture is null && _undoStack.Count > 0;
    public bool CanRedo => CanEdit && _activeTransformGesture is null && _redoStack.Count > 0;
    public int PendingTransformCommandCount => _undoStack.OfType<ModelPartTransformCommand>().Count();
    public bool HasPendingTransformCommands => PendingTransformCommandCount > 0;
    public bool HasPendingRecovery => PendingRecoveryCheckpoint is not null;
    private bool HasPendingChanges => _savedDraft is null
        ? !string.IsNullOrWhiteSpace(ModelName)
        : !string.Equals(ModelName.Trim(), _savedDraft.Name, StringComparison.Ordinal) || _isModelContentDirty;
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
        IRenderSceneRenderer? sceneRenderer = null,
        TimeSpan? autosaveDelay = null,
        PublishModelRevisionService? publishModelRevisionService = null)
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
        _publishModelRevisionService = publishModelRevisionService;
        _autosaveDelay = autosaveDelay ?? TimeSpan.FromMilliseconds(600);
        if (_autosaveDelay < TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(autosaveDelay));
        }
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
        PublishError = null;
        PublishStatus = null;
        if (_savedDraft is not null && string.Equals(value.Trim(), _savedDraft.Name, StringComparison.Ordinal))
        {
            if (_isModelContentDirty)
            {
                ScheduleAutosave();
            }
            else
            {
                CancelPendingAutosave();
            }
            UpdateDirtyState();
            return;
        }

        SaveState = PersistenceState.Dirty;
        ScheduleAutosave();
    }

    [RelayCommand(CanExecute = nameof(CanSave))]
    private Task SaveAsync() => SaveDraftAsync(cancelPendingAutosave: true);

    [RelayCommand(CanExecute = nameof(CanPublishRevision))]
    private async Task PublishModelRevisionAsync()
    {
        if (_publishModelRevisionService is null || _savedDraft is null)
        {
            return;
        }

        PublishError = null;
        PublishStatus = null;
        try
        {
            if (!await FlushPendingChangesAsync())
            {
                PublishError = SaveError ?? "Salve as alterações do modelo antes de publicar a revisão.";
                return;
            }

            IsPublishingRevision = true;
            var published = await _publishModelRevisionService.PublishAsync(
                _savedDraft.Id,
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            if (published.IsFailure)
            {
                PublishError = published.Error!.Message;
                return;
            }

            PublishStatus = $"Versão {published.Value.Revision.Value:00} publicada e preservada.";
        }
        catch (Exception)
        {
            PublishError = "Não foi possível publicar esta revisão. O rascunho permanece intacto.";
        }
        finally
        {
            IsPublishingRevision = false;
        }
    }

    [RelayCommand(CanExecute = nameof(CanSelectModelSource))]
    private async Task SelectModelSourceAsync()
    {
        if (_filePicker is null || _modelSourceImportService is null)
        {
            return;
        }

        ImportError = null;
        ImportStatus = null;
        using var operation = new CancellationTokenSource();
        _modelImportCancellation = operation;
        OnPropertyChanged(nameof(CanCancelImport));
        IsImporting = true;
        try
        {
            await using var selected = await _filePicker.PickImageAsync(operation.Token);
            if (selected is null)
            {
                return;
            }

            var result = await _modelSourceImportService.PrepareAsync(selected.Content, selected.MediaType, operation.Token);
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
        catch (OperationCanceledException)
        {
            ImportStatus = "Importação cancelada.";
        }
        finally
        {
            _modelImportCancellation = null;
            IsImporting = false;
            OnPropertyChanged(nameof(CanCancelImport));
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
        using var operation = new CancellationTokenSource();
        _modelImportCancellation = operation;
        OnPropertyChanged(nameof(CanCancelImport));
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
                var result = await _modelSourceImportService.PublishAsync(preview, _assetStore, operation.Token);
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

            var extractedParts = await _modelSourceImportService.ImportSeparatedPartsAsync(preview, _assetStore, operation.Token);
            if (extractedParts.IsFailure)
            {
                ImportError = extractedParts.Error!.Message;
                return;
            }

            await _dataInitializer.InitializeAsync(operation.Token);
            var loaded = await _contentRepository.GetAsync(_savedDraft.Id, operation.Token);
            var existingContent = loaded.IsSuccess ? loaded.Value : null;
            if (loaded.IsFailure && loaded.Error!.Code != ApplicationErrorCode.NotFound)
            {
                ImportError = loaded.Error.Message;
                return;
            }

            var content = existingContent is not null
                && existingContent.SourceAssetId == assetId
                && !existingContent.Parts.IsDefaultOrEmpty
                    ? existingContent
                    : CreateContentWithSeparatedParts(_savedDraft.Id, existingContent, assetId, preview, extractedParts.Value);

            if (!ReferenceEquals(content, existingContent))
            {
                var savedContent = await _contentRepository.SaveAsync(content, existingContent?.Revision, operation.Token);
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
            _savedModelContent = content;
            SetModelContentDirty(false);
            RefreshRigPanel();
            ClearHistory();
            SelectedModelPartId = null;
            OnPropertyChanged(nameof(PartLayers));
            OnPropertyChanged(nameof(HasModelParts));
            OnPropertyChanged(nameof(SelectedPartName));
            OnPropertyChanged(nameof(SelectedPartBounds));
            OnPropertyChanged(nameof(SelectedPartPivot));
            ImportStatus = $"Modelo carregado · {content.Parts.Length} peças · {preview.Width} × {preview.Height} · {assetId}";
            OnPropertyChanged(nameof(CanPublishModelSource));
            OnPropertyChanged(nameof(CanPublishRevision));
            PublishModelRevisionCommand.NotifyCanExecuteChanged();
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            ImportError = "Não foi possível publicar a folha de imagem. A prévia permanece disponível para nova tentativa.";
        }
        catch (OperationCanceledException)
        {
            ImportStatus = "Separação cancelada. A imagem-fonte permanece disponível para nova tentativa.";
        }
        finally
        {
            _modelImportCancellation = null;
            IsImporting = false;
            OnPropertyChanged(nameof(CanCancelImport));
        }
    }

    private static ModelDraftContent CreateContentWithSeparatedParts(
        ModelId modelId,
        ModelDraftContent? existing,
        AssetId sourceAssetId,
        ModelSourceImportPreview preview,
        IReadOnlyList<ModelSourcePartAsset> extractedParts)
    {
        var parts = extractedParts.Select(item =>
        {
            var bounds = item.SourceBounds;
            var crop = new Rect2D(0, 0, bounds.Width, bounds.Height);
            var transform = new Transform2D(
                new Point2D(bounds.X, preview.Height - bounds.Y - bounds.Height),
                new Point2D(1, 1),
                0,
                Point2D.Zero);
            return new ModelPart(
                ModelPartId.New(),
                item.Name,
                item.Asset.Id,
                crop,
                transform,
                new ModelPartSourceTransform(
                    new Rect2D(bounds.X, bounds.Y, bounds.Width, bounds.Height),
                    transform));
        }).ToArray();

        return ModelDraftContent.Restore(
            ModelDraftContent.CurrentSchemaVersion,
            modelId,
            existing is null ? Revision.Initial : existing.Revision.Next(),
            existing?.Slot,
            sourceAssetId,
            preview.Width,
            preview.Height,
            parts,
            parts.Select(part => part.Id));
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
        SelectModelPart(_modelContent is null ? null : ModelDraftHitTester.HitTest(_modelContent, scenePoint));
    }

    [RelayCommand]
    private void SelectPartLayer(ModelPartId partId) => SelectModelPart(partId);

    [RelayCommand]
    private void ClearSelection() => SelectModelPart(null);

    [RelayCommand]
    private void ConnectRigParts()
    {
        if (!CanEditRig || _modelContent is null || SelectedRigParent is null || SelectedRigChild is null)
        {
            return;
        }

        try
        {
            var editor = new ModelRigEditor(_modelContent, _modelContent.RigJoints);
            var parentAnchor = ModelDraftHitTester.GetPartPivot(_modelContent, SelectedRigParent.Id) ?? Point2D.Zero;
            var childAnchor = ModelDraftHitTester.GetPartPivot(_modelContent, SelectedRigChild.Id) ?? Point2D.Zero;
            var joint = editor.Connect(SelectedRigParent.Id, SelectedRigChild.Id, parentAnchor, childAnchor);
            ExecuteModelCommand(new RigJointCollectionCommand(_modelContent.RigJoints, editor.Graph.Joints.ToImmutableArray()));
            RigError = null;
            RefreshRigPanel(joint.Id);
        }
        catch (ArgumentException exception)
        {
            RigError = exception.Message;
        }
    }

    [RelayCommand]
    private void ApplyRigJointAnchors()
    {
        if (!CanEditRig || _modelContent is null || SelectedRigJoint is null) return;
        if (!TryReadAnchor(out var parent, out var child))
        {
            RigError = "Informe coordenadas numéricas válidas para as duas âncoras.";
            return;
        }

        try
        {
            var editor = new ModelRigEditor(_modelContent, _modelContent.RigJoints);
            editor.ChangeAnchors(SelectedRigJoint.Joint.Id, parent, child);
            ExecuteModelCommand(new RigJointCollectionCommand(_modelContent.RigJoints, editor.Graph.Joints.ToImmutableArray()));
            RigError = null;
            RefreshRigPanel(SelectedRigJoint.Joint.Id);
        }
        catch (Exception exception) when (exception is ArgumentException or KeyNotFoundException)
        {
            RigError = exception.Message;
        }
    }

    [RelayCommand]
    private void ToggleSelectedRigJointMode()
    {
        if (!CanEditRig || _modelContent is null || SelectedRigJoint is null) return;
        var id = SelectedRigJoint.Joint.Id;
        var editor = new ModelRigEditor(_modelContent, _modelContent.RigJoints);
        editor.SetFixed(id, SelectedRigJoint.Joint.Mode != RigJointMode.Fixed);
        ExecuteModelCommand(new RigJointCollectionCommand(_modelContent.RigJoints, editor.Graph.Joints.ToImmutableArray()));
        RigError = null;
        RefreshRigPanel(id);
    }

    [RelayCommand]
    private void RemoveSelectedRigJoint()
    {
        if (!CanEditRig || _modelContent is null || SelectedRigJoint is null) return;
        var editor = new ModelRigEditor(_modelContent, _modelContent.RigJoints);
        editor.Disconnect(SelectedRigJoint.Joint.Id);
        ExecuteModelCommand(new RigJointCollectionCommand(_modelContent.RigJoints, editor.Graph.Joints.ToImmutableArray()));
        RigError = null;
        RefreshRigPanel();
    }

    [RelayCommand]
    private void TogglePartVisibility(ModelPartId partId)
    {
        if (!CanEdit || _modelContent is null)
        {
            return;
        }

        var part = _modelContent.Parts.FirstOrDefault(candidate => candidate.Id == partId);
        if (part is null)
        {
            return;
        }

        ExecuteModelCommand(new ModelPartVisibilityCommand(part.Id, part.IsVisible, !part.IsVisible));
    }

    [RelayCommand]
    private void BringPartForward(ModelPartId partId) => MovePartLayer(partId, 1);

    [RelayCommand]
    private void SendPartBackward(ModelPartId partId) => MovePartLayer(partId, -1);

    [RelayCommand(CanExecute = nameof(CanUndo))]
    private void Undo()
    {
        if (!CanUndo || _modelContent is null)
        {
            return;
        }

        var command = _undoStack[^1];
        _undoStack.RemoveAt(_undoStack.Count - 1);
        _modelContent = command.Revert(_modelContent);
        _redoStack.Add(command);
        TrimHistory(_redoStack);
        NotifyHistoryChanged();
        NotifyModelContentChanged();
    }

    [RelayCommand(CanExecute = nameof(CanRedo))]
    private void Redo()
    {
        if (!CanRedo || _modelContent is null)
        {
            return;
        }

        var command = _redoStack[^1];
        _redoStack.RemoveAt(_redoStack.Count - 1);
        _modelContent = command.Apply(_modelContent);
        _undoStack.Add(command);
        TrimHistory(_undoStack);
        NotifyHistoryChanged();
        NotifyModelContentChanged();
    }

    private void SelectModelPart(ModelPartId? partId)
    {
        if (partId is { } id && (_modelContent is null || !_modelContent.Parts.Any(part => part.Id == id)))
        {
            return;
        }

        SelectedModelPartId = partId;
    }

    private void MovePartLayer(ModelPartId partId, int direction)
    {
        if (!CanEdit || _modelContent is null)
        {
            return;
        }

        var currentIndex = _modelContent.LayerOrder.IndexOf(partId);
        if (currentIndex < 0)
        {
            return;
        }
        var targetIndex = currentIndex + direction;
        if (targetIndex < 0 || targetIndex >= _modelContent.LayerOrder.Length)
        {
            return;
        }

        var layerOrder = _modelContent.LayerOrder.ToArray();
        (layerOrder[currentIndex], layerOrder[targetIndex]) = (layerOrder[targetIndex], layerOrder[currentIndex]);
        ExecuteModelCommand(new ModelPartLayerOrderCommand(_modelContent.LayerOrder, layerOrder.ToImmutableArray()));
    }

    private void ExecuteModelCommand(IModelDraftCommand command)
    {
        if (_modelContent is null)
        {
            return;
        }

        _modelContent = command.Apply(_modelContent);
        PushUndoCommand(command);
        NotifyModelContentChanged();
    }

    private void PushUndoCommand(IModelDraftCommand command)
    {
        _undoStack.Add(command);
        TrimHistory(_undoStack);
        _redoStack.Clear();
        NotifyHistoryChanged();
    }

    private void ClearHistory()
    {
        _undoStack.Clear();
        _redoStack.Clear();
        NotifyHistoryChanged();
    }

    private static void TrimHistory(List<IModelDraftCommand> history)
    {
        if (history.Count > HistoryLimit)
        {
            history.RemoveRange(0, history.Count - HistoryLimit);
        }
    }

    private void NotifyHistoryChanged()
    {
        OnPropertyChanged(nameof(UndoCount));
        OnPropertyChanged(nameof(RedoCount));
        OnPropertyChanged(nameof(CanUndo));
        OnPropertyChanged(nameof(CanRedo));
        OnPropertyChanged(nameof(PendingTransformCommandCount));
        OnPropertyChanged(nameof(HasPendingTransformCommands));
        UndoCommand.NotifyCanExecuteChanged();
        RedoCommand.NotifyCanExecuteChanged();
    }

    private void NotifyModelContentChanged()
    {
        var content = _modelContent;
        if (content is null)
        {
            return;
        }

        OnPropertyChanged(nameof(PartLayers));
        OnPropertyChanged(nameof(HasModelParts));
        OnPropertyChanged(nameof(SelectedPartBounds));
        OnPropertyChanged(nameof(SelectedPartPivot));
        RefreshRigPanel();
        SetModelContentDirty(true);
        _ = RenderModelPreviewAsync(content);
    }

    private void RefreshRigPanel(RigJointId? selectedJointId = null)
    {
        var currentJointId = selectedJointId ?? SelectedRigJoint?.Joint.Id;
        var options = RigPartOptions;
        if (SelectedRigParent is null || options.All(option => option.Id != SelectedRigParent.Id))
        {
            SelectedRigParent = options.FirstOrDefault();
        }
        if (SelectedRigChild is null || options.All(option => option.Id != SelectedRigChild.Id)
            || SelectedRigChild.Id == SelectedRigParent?.Id)
        {
            SelectedRigChild = options.FirstOrDefault(option => option.Id != SelectedRigParent?.Id);
        }

        OnPropertyChanged(nameof(RigPartOptions));
        OnPropertyChanged(nameof(RigJointItems));
        OnPropertyChanged(nameof(CanEditRig));
        OnPropertyChanged(nameof(CanEditSelectedRigJoint));
        OnPropertyChanged(nameof(HasRigEditingParts));
        OnPropertyChanged(nameof(NeedsRigParts));
        SelectedRigJoint = currentJointId is { } id
            ? RigJointItems.FirstOrDefault(item => item.Joint.Id == id)
            : null;
    }

    private bool TryReadAnchor(out Point2D parent, out Point2D child)
    {
        parent = default;
        child = default;
        if (!TryParseCoordinate(RigParentAnchorX, out var parentX)
            || !TryParseCoordinate(RigParentAnchorY, out var parentY)
            || !TryParseCoordinate(RigChildAnchorX, out var childX)
            || !TryParseCoordinate(RigChildAnchorY, out var childY))
        {
            return false;
        }

        parent = new Point2D(parentX, parentY);
        child = new Point2D(childX, childY);
        return true;
    }

    private static bool TryParseCoordinate(string value, out double coordinate) =>
        double.TryParse(value, NumberStyles.Float, CultureInfo.CurrentCulture, out coordinate)
        || double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out coordinate);

    private static string Format(double value) => value.ToString("0.##", CultureInfo.CurrentCulture);

    public void BeginModelPartTransform(TransformGestureStart gesture)
    {
        if (!CanEdit || _modelContent is null || SelectedModelPartId is not { } partId)
        {
            return;
        }

        var part = _modelContent.Parts.FirstOrDefault(candidate => candidate.Id == partId && candidate.IsVisible);
        var partIndex = _modelContent.LayerOrder.IndexOf(partId);
        if (part is null || partIndex < 0)
        {
            return;
        }

        var previewSize = ModelDraftRenderSceneBuilder.GetPreviewSize(_modelContent);
        var layer = ModelDraftRenderSceneBuilder.CreatePartLayer(part, previewSize.Scale, partIndex);
        var sceneMatrix = RenderLayerGeometry.GetSceneMatrix(layer, previewSize.Height);
        Point2D localStart;
        try
        {
            localStart = sceneMatrix.Invert().Transform(gesture.ScenePoint);
        }
        catch (InvalidOperationException)
        {
            return;
        }

        _activeTransformGesture = new ActiveModelTransformGesture(
            new ModelPartTransformCommand(part.Id, part.Transform, part.Transform, gesture.Kind == ModelPartTransformKind.Move),
            gesture.Kind,
            gesture.ScenePoint,
            localStart,
            sceneMatrix,
            previewSize.Scale,
            sceneMatrix.Transform(part.Transform.Pivot));
        NotifyHistoryChanged();
    }

    public void UpdateModelPartTransform(Point2D scenePoint)
    {
        if (!CanEdit || _activeTransformGesture is not { } active || _modelContent is null)
        {
            return;
        }

        var before = active.Command.Before;
        Transform2D after;
        switch (active.Kind)
        {
            case ModelPartTransformKind.Move:
                after = new Transform2D(
                    new Point2D(
                        before.Translation.X + (scenePoint.X - active.StartScenePoint.X) / active.SceneScale,
                        before.Translation.Y - (scenePoint.Y - active.StartScenePoint.Y) / active.SceneScale),
                    before.Scale,
                    before.RotationRadians,
                    before.Pivot,
                    before.FlipX,
                    before.FlipY);
                break;
            case ModelPartTransformKind.Scale:
                Point2D localCurrent;
                try
                {
                    localCurrent = active.SceneMatrix.Invert().Transform(scenePoint);
                }
                catch (InvalidOperationException)
                {
                    return;
                }

                var startX = active.LocalStartPoint.X - before.Pivot.X;
                var startY = active.LocalStartPoint.Y - before.Pivot.Y;
                var ratioX = Math.Abs(startX) < 0.001 ? 1 : (localCurrent.X - before.Pivot.X) / startX;
                var ratioY = Math.Abs(startY) < 0.001 ? 1 : (localCurrent.Y - before.Pivot.Y) / startY;
                after = new Transform2D(
                    before.Translation,
                    new Point2D(before.Scale.X * Math.Clamp(ratioX, 0.05, 50), before.Scale.Y * Math.Clamp(ratioY, 0.05, 50)),
                    before.RotationRadians,
                    before.Pivot,
                    before.FlipX,
                    before.FlipY);
                break;
            case ModelPartTransformKind.Rotate:
                var startAngle = Math.Atan2(active.StartScenePoint.Y - active.PivotScenePoint.Y, active.StartScenePoint.X - active.PivotScenePoint.X);
                var currentAngle = Math.Atan2(scenePoint.Y - active.PivotScenePoint.Y, scenePoint.X - active.PivotScenePoint.X);
                after = new Transform2D(
                    before.Translation,
                    before.Scale,
                    before.RotationRadians + startAngle - currentAngle,
                    before.Pivot,
                    before.FlipX,
                    before.FlipY);
                break;
            default:
                return;
        }

        if (after == active.Command.After)
        {
            return;
        }

        var command = active.Command with { After = after };
        _modelContent = command.Apply(_modelContent);
        _activeTransformGesture = active with { Command = command };
        OnPropertyChanged(nameof(SelectedPartBounds));
        OnPropertyChanged(nameof(SelectedPartPivot));
        _ = RenderModelPreviewAsync(_modelContent);
    }

    public void CompleteModelPartTransform()
    {
        if (_activeTransformGesture is not { } active)
        {
            return;
        }

        _activeTransformGesture = null;
        RefreshRigPanel();
        if (active.Command.Before != active.Command.After)
        {
            PushUndoCommand(active.Command);
            SetModelContentDirty(true);
        }
        else
        {
            NotifyHistoryChanged();
        }
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
        if (_modelImportCancellation is { } operation)
        {
            operation.Cancel();
            ImportStatus = "Cancelando operação…";
            return;
        }

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

        if (!HasPendingChanges)
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
               !_isModelContentDirty &&
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
            var draftMetadataDirty = _savedDraft is null
                || !string.Equals(ModelName.Trim(), _savedDraft.Name, StringComparison.Ordinal);
            var checkpoint = _checkpointStore is null || !draftMetadataDirty
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

            if (draftMetadataDirty)
            {
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
                OnPropertyChanged(nameof(CanPublishRevision));
                PublishModelRevisionCommand.NotifyCanExecuteChanged();
            }

            if (_isModelContentDirty && _modelContent is { } currentContent)
            {
                if (_contentRepository is null)
                {
                    SaveError = "O conteúdo do modelo não está conectado ao serviço de persistência.";
                    diagnosticErrorCode = DiagnosticErrorCode.StorageFailure;
                    SaveState = PersistenceState.Error;
                    return;
                }

                var expectedContentRevision = _savedModelContent?.Revision;
                var nextRevision = expectedContentRevision?.Next() ?? Revision.Initial;
                var contentToSave = ModelDraftContent.Restore(
                    currentContent.SchemaVersion,
                    currentContent.ModelId,
                    nextRevision,
                    currentContent.Slot,
                    currentContent.SourceAssetId,
                    currentContent.SourceWidth,
                    currentContent.SourceHeight,
                    currentContent.Parts,
                    currentContent.LayerOrder,
                    currentContent.RigJoints);
                var contentResult = await _contentRepository.SaveAsync(contentToSave, expectedContentRevision);
                if (contentResult.IsFailure)
                {
                    SaveError = contentResult.Error!.Code == ApplicationErrorCode.Conflict
                        ? "O conteúdo deste modelo foi alterado em outra sessão. Suas alterações locais foram preservadas e a versão salva não foi sobrescrita."
                        : contentResult.Error.Message;
                    diagnosticErrorCode = contentResult.Error.Code == ApplicationErrorCode.Conflict
                        ? DiagnosticErrorCode.RevisionConflict
                        : DiagnosticErrorCode.StorageFailure;
                    SaveState = PersistenceState.Error;
                    return;
                }

                _modelContent = contentResult.Value;
                _savedModelContent = contentResult.Value;
                SetModelContentDirty(false);
            }

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

    private void SetModelContentDirty(bool isDirty)
    {
        if (_isModelContentDirty != isDirty)
        {
            _isModelContentDirty = isDirty;
            OnPropertyChanged(nameof(CanSave));
            SaveCommand.NotifyCanExecuteChanged();
        }

        if (!isDirty)
        {
            return;
        }

        SaveError = null;
        PublishError = null;
        PublishStatus = null;
        SaveState = PersistenceState.Dirty;
        ScheduleAutosave();
    }

    private void UpdateDirtyState()
    {
        OnPropertyChanged(nameof(CanSave));
        SaveCommand.NotifyCanExecuteChanged();
        if (HasPendingChanges)
        {
            if (SaveState != PersistenceState.Error)
            {
                SaveState = PersistenceState.Dirty;
            }

            return;
        }

        SaveError = null;
        SaveState = PersistenceState.Saved;
    }

    private async Task RunAutosaveAfterDelayAsync(CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(_autosaveDelay, cancellationToken);
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

    private sealed record ActiveModelTransformGesture(
        ModelPartTransformCommand Command,
        ModelPartTransformKind Kind,
        Point2D StartScenePoint,
        Point2D LocalStartPoint,
        Matrix2D SceneMatrix,
        double SceneScale,
        Point2D PivotScenePoint);
}
