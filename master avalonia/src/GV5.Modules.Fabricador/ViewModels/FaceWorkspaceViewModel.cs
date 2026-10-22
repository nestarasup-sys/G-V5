using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using System.Collections.ObjectModel;
using System.Globalization;
using GV5.Application.Contracts;
using GV5.Assets.Decoding;
using GV5.Assets.Processing;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using GV5.Modules.Fabricador.Import;
using GV5.Modules.Fabricador.Rendering;
using GV5.Rendering;

namespace GV5.Modules.Fabricador.ViewModels;

/// <summary>Owns staged facial-sheet review and persistence for one immutable model revision.</summary>
public partial class FaceWorkspaceViewModel : ObservableObject, IAsyncDisposable
{
    private readonly IFilePicker? _filePicker;
    private readonly FaceSheetImportService? _importService;
    private readonly IFaceCatalogRepository? _catalogRepository;
    private readonly IAssetStore? _assetStore;
    private readonly FaceCatalogPreviewRenderer? _previewRenderer;
    private readonly HeadExtraImportService? _headExtraImportService;
    private readonly IHeadExtraLibraryRepository? _headExtraLibraryRepository;
    private readonly FaceDetailImportService? _faceDetailImportService;
    private readonly IFaceDetailLibraryRepository? _faceDetailLibraryRepository;
    private HeadExtraLibraryDraft? _headExtraLibrary;
    private FaceDetailLibraryDraft? _faceDetailLibrary;
    private ModelSlot _headExtraModelSlot = ModelSlot.From(1);
    private bool _headExtraLibraryPersisted;
    private bool _faceDetailLibraryPersisted;
    private PublishedModelRevision? _pinnedModel;
    private FaceCatalogDraft? _savedCatalog;
    private FaceCatalogDraft? _previewCatalogOverride;
    private readonly Dictionary<FaceId, FaceCatalogDraft> _catalogsById = [];
    private readonly Dictionary<FaceId, PublishedFaceCatalogRevision> _latestPublications = [];
    private int _disposed;
    private CancellationTokenSource? _composedPreviewCancellation;
    private long _composedPreviewVersion;
    private FaceComponentId? _gestureComponentId;
    private Transform2D? _gestureStartTransform;
    private bool _gestureHasMoved;
    private bool _gestureIsHeadExtra;
    private bool _previewingHeadExtra;
    private bool _previewingFaceDetail;
    private bool _gestureIsFaceDetail;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasComposedPreviewError))]
    [NotifyPropertyChangedFor(nameof(HasComposedPreviewPlaceholder))]
    private string? composedPreviewError;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasComposedPreview))]
    [NotifyPropertyChangedFor(nameof(HasComposedPreviewPlaceholder))]
    private RenderedFrame? composedPreviewFrame;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ComposedPreviewPlaceholder))]
    private bool isRenderingComposedPreview;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasPreview))]
    [NotifyPropertyChangedFor(nameof(CanConfirmImport))]
    [NotifyPropertyChangedFor(nameof(CanChangeSheetKind))]
    [NotifyPropertyChangedFor(nameof(CanChangeNoseMode))]
    private FaceSheetImportPreview? preview;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasError))]
    private string? error;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasStatus))]
    private string? status;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CatalogStatus))]
    [NotifyPropertyChangedFor(nameof(CanConfirmImport))]
    [NotifyPropertyChangedFor(nameof(CanPublishCatalog))]
    [NotifyPropertyChangedFor(nameof(CanAddHeadExtra))]
    [NotifyPropertyChangedFor(nameof(PublicationStatus))]
    [NotifyPropertyChangedFor(nameof(HasSavedCatalog))]
    [NotifyPropertyChangedFor(nameof(PublishButtonLabel))]
    private FaceCatalogChoiceItem? selectedCatalog;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(SelectedSheetLabel))]
    [NotifyPropertyChangedFor(nameof(IsNoseSheetSelected))]
    [NotifyPropertyChangedFor(nameof(CanChangeNoseMode))]
    private FaceSheetKindChoiceItem selectedSheetKind = FaceSheetKindChoices[1];

    [ObservableProperty]
    private FaceNoseSheetModeChoiceItem selectedNoseSheetMode = FaceNoseSheetModeChoices[0];

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanPublishCatalog))]
    [NotifyPropertyChangedFor(nameof(PublicationStatus))]
    [NotifyPropertyChangedFor(nameof(PublishButtonLabel))]
    private PublishedFaceCatalogRevision? latestPublication;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanApplyComponentTransform))]
    [NotifyCanExecuteChangedFor(nameof(ApplyComponentTransformCommand))]
    [NotifyPropertyChangedFor(nameof(CanApplyComponentName))]
    [NotifyCanExecuteChangedFor(nameof(ApplyComponentNameCommand))]
    [NotifyPropertyChangedFor(nameof(CanRemoveSelectedComponent))]
    [NotifyCanExecuteChangedFor(nameof(RemoveSelectedComponentCommand))]
    [NotifyPropertyChangedFor(nameof(CanToggleSelectedVisibility))]
    [NotifyCanExecuteChangedFor(nameof(ToggleSelectedVisibilityCommand))]
    [NotifyPropertyChangedFor(nameof(SelectedVisibilityButtonLabel))]
    private FaceComponentChoiceItem? selectedComponent;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanApplyComponentName))]
    [NotifyCanExecuteChangedFor(nameof(ApplyComponentNameCommand))]
    private string componentName = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSaveSelectedHeadExtra))]
    [NotifyPropertyChangedFor(nameof(CanResetSelectedHeadExtra))]
    [NotifyCanExecuteChangedFor(nameof(SaveSelectedHeadExtraCommand))]
    [NotifyCanExecuteChangedFor(nameof(ResetSelectedHeadExtraCommand))]
    private HeadExtraChoiceItem? selectedHeadExtra;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSaveSelectedFaceDetail))]
    [NotifyPropertyChangedFor(nameof(CanResetSelectedFaceDetail))]
    [NotifyCanExecuteChangedFor(nameof(SaveSelectedFaceDetailCommand))]
    [NotifyCanExecuteChangedFor(nameof(ResetSelectedFaceDetailCommand))]
    private FaceDetailChoiceItem? selectedFaceDetail;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSaveSelectedFaceDetail))]
    [NotifyCanExecuteChangedFor(nameof(SaveSelectedFaceDetailCommand))]
    private string faceDetailName = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSaveSelectedFaceDetail))]
    [NotifyCanExecuteChangedFor(nameof(SaveSelectedFaceDetailCommand))]
    private string faceDetailX = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSaveSelectedFaceDetail))]
    [NotifyCanExecuteChangedFor(nameof(SaveSelectedFaceDetailCommand))]
    private string faceDetailY = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSaveSelectedFaceDetail))]
    [NotifyCanExecuteChangedFor(nameof(SaveSelectedFaceDetailCommand))]
    private string faceDetailScaleX = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSaveSelectedFaceDetail))]
    [NotifyCanExecuteChangedFor(nameof(SaveSelectedFaceDetailCommand))]
    private string faceDetailScaleY = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSaveSelectedFaceDetail))]
    [NotifyCanExecuteChangedFor(nameof(SaveSelectedFaceDetailCommand))]
    private string faceDetailRotation = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanImportFaceDetail))]
    [NotifyCanExecuteChangedFor(nameof(ImportFaceDetailCommand))]
    private FaceDetailKindChoiceItem selectedFaceDetailKind = FaceDetailKindChoices[0];

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSaveSelectedHeadExtra))]
    [NotifyCanExecuteChangedFor(nameof(SaveSelectedHeadExtraCommand))]
    private string headExtraName = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSaveSelectedHeadExtra))]
    [NotifyCanExecuteChangedFor(nameof(SaveSelectedHeadExtraCommand))]
    private string headExtraX = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSaveSelectedHeadExtra))]
    [NotifyCanExecuteChangedFor(nameof(SaveSelectedHeadExtraCommand))]
    private string headExtraY = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSaveSelectedHeadExtra))]
    [NotifyCanExecuteChangedFor(nameof(SaveSelectedHeadExtraCommand))]
    private string headExtraScaleX = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSaveSelectedHeadExtra))]
    [NotifyCanExecuteChangedFor(nameof(SaveSelectedHeadExtraCommand))]
    private string headExtraScaleY = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSaveSelectedHeadExtra))]
    [NotifyCanExecuteChangedFor(nameof(SaveSelectedHeadExtraCommand))]
    private string headExtraRotation = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanApplyComponentTransform))]
    [NotifyCanExecuteChangedFor(nameof(ApplyComponentTransformCommand))]
    [NotifyPropertyChangedFor(nameof(CanApplyComponentName))]
    [NotifyCanExecuteChangedFor(nameof(ApplyComponentNameCommand))]
    private string componentX = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanApplyComponentTransform))]
    [NotifyCanExecuteChangedFor(nameof(ApplyComponentTransformCommand))]
    private string componentY = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanApplyComponentTransform))]
    [NotifyCanExecuteChangedFor(nameof(ApplyComponentTransformCommand))]
    private string componentScaleX = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanApplyComponentTransform))]
    [NotifyCanExecuteChangedFor(nameof(ApplyComponentTransformCommand))]
    private string componentScaleY = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanApplyComponentTransform))]
    [NotifyCanExecuteChangedFor(nameof(ApplyComponentTransformCommand))]
    private string componentRotation = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSelectSheet))]
    [NotifyPropertyChangedFor(nameof(CanConfirmImport))]
    [NotifyPropertyChangedFor(nameof(CanChangeSheetKind))]
    [NotifyPropertyChangedFor(nameof(CanChangeNoseMode))]
    [NotifyPropertyChangedFor(nameof(CanAddHeadExtra))]
    [NotifyPropertyChangedFor(nameof(CanRemoveSelectedComponent))]
    [NotifyPropertyChangedFor(nameof(CanToggleSelectedVisibility))]
    [NotifyPropertyChangedFor(nameof(CanApplyComponentName))]
    [NotifyPropertyChangedFor(nameof(CanSaveSelectedHeadExtra))]
    [NotifyPropertyChangedFor(nameof(CanRemoveSelectedHeadExtra))]
    [NotifyPropertyChangedFor(nameof(CanAddSelectedHeadExtraToCatalog))]
    [NotifyPropertyChangedFor(nameof(CanResetSelectedHeadExtra))]
    [NotifyPropertyChangedFor(nameof(CanImportFaceDetail))]
    [NotifyPropertyChangedFor(nameof(CanSaveSelectedFaceDetail))]
    [NotifyPropertyChangedFor(nameof(CanResetSelectedFaceDetail))]
    [NotifyPropertyChangedFor(nameof(CanRemoveSelectedFaceDetail))]
    [NotifyPropertyChangedFor(nameof(CanAddSelectedFaceDetailToCatalog))]
    [NotifyCanExecuteChangedFor(nameof(AddHeadExtraCommand))]
    [NotifyCanExecuteChangedFor(nameof(SelectFaceSheetCommand))]
    [NotifyCanExecuteChangedFor(nameof(ConfirmImportCommand))]
    [NotifyCanExecuteChangedFor(nameof(PublishCatalogCommand))]
    [NotifyPropertyChangedFor(nameof(CanApplyComponentTransform))]
    [NotifyCanExecuteChangedFor(nameof(ApplyComponentTransformCommand))]
    [NotifyCanExecuteChangedFor(nameof(AddHeadExtraCommand))]
    [NotifyCanExecuteChangedFor(nameof(RemoveSelectedComponentCommand))]
    [NotifyCanExecuteChangedFor(nameof(ToggleSelectedVisibilityCommand))]
    [NotifyCanExecuteChangedFor(nameof(ApplyComponentNameCommand))]
    [NotifyCanExecuteChangedFor(nameof(SaveSelectedHeadExtraCommand))]
    [NotifyCanExecuteChangedFor(nameof(RemoveSelectedHeadExtraCommand))]
    [NotifyCanExecuteChangedFor(nameof(AddSelectedHeadExtraToCatalogCommand))]
    [NotifyCanExecuteChangedFor(nameof(ResetSelectedHeadExtraCommand))]
    [NotifyCanExecuteChangedFor(nameof(ImportFaceDetailCommand))]
    [NotifyCanExecuteChangedFor(nameof(SaveSelectedFaceDetailCommand))]
    [NotifyCanExecuteChangedFor(nameof(ResetSelectedFaceDetailCommand))]
    [NotifyCanExecuteChangedFor(nameof(RemoveSelectedFaceDetailCommand))]
    [NotifyCanExecuteChangedFor(nameof(AddSelectedFaceDetailToCatalogCommand))]
    [NotifyCanExecuteChangedFor(nameof(AddHeadExtraCommand))]
    [NotifyCanExecuteChangedFor(nameof(SaveSelectedHeadExtraCommand))]
    [NotifyCanExecuteChangedFor(nameof(RemoveSelectedHeadExtraCommand))]
    [NotifyCanExecuteChangedFor(nameof(AddSelectedHeadExtraToCatalogCommand))]
    private bool isBusy;

    public FaceWorkspaceViewModel(IFilePicker? filePicker, FaceSheetImportService? importService,
        IFaceCatalogRepository? catalogRepository = null, IAssetStore? assetStore = null,
        AssetImageDecoder? imageDecoder = null, IRenderSceneRenderer? sceneRenderer = null,
        HeadExtraImportService? headExtraImportService = null,
        IHeadExtraLibraryRepository? headExtraLibraryRepository = null,
        FaceDetailImportService? faceDetailImportService = null,
        IFaceDetailLibraryRepository? faceDetailLibraryRepository = null)
    {
        _filePicker = filePicker;
        _importService = importService;
        _catalogRepository = catalogRepository;
        _assetStore = assetStore;
        _headExtraImportService = headExtraImportService;
        _headExtraLibraryRepository = headExtraLibraryRepository;
        _faceDetailImportService = faceDetailImportService;
        _faceDetailLibraryRepository = faceDetailLibraryRepository;
        if (assetStore is not null && imageDecoder is not null && sceneRenderer is not null)
            _previewRenderer = new FaceCatalogPreviewRenderer(assetStore, imageDecoder, sceneRenderer);
        CatalogChoices = [];
        ComponentChoices = [];
        HeadExtraChoices = [];
        FaceDetailChoices = [];
    }

    public bool HasPreview => Preview is not null;
    public bool HasError => !string.IsNullOrWhiteSpace(Error);
    public bool HasComposedPreview => ComposedPreviewFrame is not null;
    public bool HasComposedPreviewError => !string.IsNullOrWhiteSpace(ComposedPreviewError);
    public bool HasComposedPreviewPlaceholder => !HasComposedPreview && !HasComposedPreviewError;
    public string ComposedPreviewPlaceholder => IsRenderingComposedPreview
        ? "Compondo prévia facial…"
        : "A prévia aparece ao abrir uma revisão publicada do modelo.";
    public double ComposedPreviewModelScale => _pinnedModel is null ? 1
        : ModelDraftRenderSceneBuilder.GetPreviewSize(_pinnedModel.Content, 512).Scale;
    public bool HasStatus => !string.IsNullOrWhiteSpace(Status);
    public bool CanChangeSheetKind => !HasPreview && !IsBusy;
    public bool HasMultipleCatalogs => CatalogChoices.Count > 1;
    public bool HasSavedCatalog => _savedCatalog is not null;
    public int HeadExtraLibraryCount => _headExtraLibrary?.Assets.Length ?? 0;
    public int FaceDetailLibraryCount => _faceDetailLibrary?.Assets.Length ?? 0;
    public int HeadExtraCount => _savedCatalog?.Components.Count(component => component.Kind == FaceComponentKind.HeadExtra) ?? 0;
    public int VisibleHeadExtraCount => _savedCatalog?.Components.Count(component => component.Kind == FaceComponentKind.HeadExtra && component.IsVisible) ?? 0;
    public string SelectedVisibilityButtonLabel => SelectedComponent?.IsVisible == true ? "Ocultar no preview" : "Mostrar no preview";
    public bool IsNoseSheetSelected => SelectedSheetKind.Kind == FaceSheetKind.Nose;
    public ObservableCollection<FaceCatalogChoiceItem> CatalogChoices { get; }
    public ObservableCollection<FaceComponentChoiceItem> ComponentChoices { get; }
    public ObservableCollection<HeadExtraChoiceItem> HeadExtraChoices { get; }
    public ObservableCollection<FaceDetailChoiceItem> FaceDetailChoices { get; }
    public IReadOnlyList<FaceDetailKindChoiceItem> FaceDetailKinds => FaceDetailKindChoices;
    public IReadOnlyList<FaceSheetKindChoiceItem> SheetKinds => FaceSheetKindChoices;
    public IReadOnlyList<FaceNoseSheetModeChoiceItem> NoseSheetModes => FaceNoseSheetModeChoices;
    public string SelectedSheetLabel => SelectedSheetKind.Label;
    public bool CanSelectSheet => !IsBusy && HeadPart is not null && _filePicker is not null && _importService is not null;
    public bool CanAddHeadExtra => !IsBusy && HeadPart is not null && _filePicker is not null
        && _headExtraImportService is not null && _assetStore is not null && _headExtraLibraryRepository is not null
        && (_headExtraLibrary?.Assets.Length ?? 0) < HeadExtraLibraryDraft.MaximumAssets;
    public bool CanSaveSelectedHeadExtra => !IsBusy && _headExtraLibrary is not null
        && _headExtraLibraryRepository is not null && SelectedHeadExtra is not null
        && !string.IsNullOrWhiteSpace(HeadExtraName) && HeadExtraName.Trim().Length <= 120
        && TryReadHeadExtraTransform(out _);
    public bool CanRemoveSelectedHeadExtra => !IsBusy && _headExtraLibrary is not null
        && _headExtraLibraryRepository is not null && SelectedHeadExtra is not null;
    public bool CanResetSelectedHeadExtra => !IsBusy && _headExtraLibrary is not null
        && _headExtraLibraryRepository is not null && SelectedHeadExtra is not null && HeadPart is not null;
    public bool CanImportFaceDetail => !IsBusy && HeadPart is not null && _filePicker is not null
        && _faceDetailImportService is not null && _assetStore is not null && _faceDetailLibraryRepository is not null
        && (_faceDetailLibrary?.Assets.Length ?? 0) < FaceDetailLibraryDraft.MaximumAssets;
    public bool CanSaveSelectedFaceDetail => !IsBusy && _faceDetailLibrary is not null
        && _faceDetailLibraryRepository is not null && SelectedFaceDetail is not null
        && !string.IsNullOrWhiteSpace(FaceDetailName) && FaceDetailName.Trim().Length <= 120
        && TryReadFaceDetailTransform(out _);
    public bool CanResetSelectedFaceDetail => !IsBusy && _faceDetailLibrary is not null
        && _faceDetailLibraryRepository is not null && SelectedFaceDetail is not null && HeadPart is not null;
    public bool CanRemoveSelectedFaceDetail => !IsBusy && _faceDetailLibrary is not null
        && _faceDetailLibraryRepository is not null && SelectedFaceDetail is not null;
    public bool CanAddSelectedFaceDetailToCatalog => !IsBusy && _pinnedModel is not null
        && _catalogRepository is not null && SelectedFaceDetail is not null
        && (_savedCatalog?.Components.Length ?? 0) < FaceCatalogDraft.MaximumComponents
        && (!HasMultipleCatalogs || SelectedCatalog is not null);
    public bool CanAddSelectedHeadExtraToCatalog => !IsBusy && _pinnedModel is not null
        && _catalogRepository is not null && SelectedHeadExtra is not null
        && (_savedCatalog?.Components.Length ?? 0) < FaceCatalogDraft.MaximumComponents
        && (!HasMultipleCatalogs || SelectedCatalog is not null);
    public bool CanRemoveSelectedComponent => !IsBusy && _savedCatalog is not null
        && _catalogRepository is not null && SelectedComponent is not null;
    public bool CanApplyComponentName => !IsBusy && _savedCatalog is not null && _catalogRepository is not null
        && SelectedComponent is not null && !string.IsNullOrWhiteSpace(ComponentName)
        && ComponentName.Trim().Length <= 120
        && !string.Equals(ComponentName.Trim(), SelectedComponent.Name, StringComparison.Ordinal);
    public bool CanToggleSelectedVisibility => !IsBusy && _savedCatalog is not null
        && _catalogRepository is not null && SelectedComponent is not null
        && (SelectedComponent.IsVisible || SelectedComponent.Kind != FaceComponentKind.HeadExtra || VisibleHeadExtraCount < 8);
    public bool CanChangeNoseMode => IsNoseSheetSelected && CanChangeSheetKind;
    public bool CanConfirmImport => !IsBusy && Preview is not null && _pinnedModel is not null
        && HeadPart is not null && _catalogRepository is not null && _assetStore is not null
        && (!HasMultipleCatalogs || SelectedCatalog is not null);
    public bool CanPublishCatalog => !IsBusy && _savedCatalog is { Components.Length: > 0 }
        && _catalogRepository is not null
        && LatestPublication?.DraftRevision != _savedCatalog.Revision;
    public bool CanApplyComponentTransform => !IsBusy && _catalogRepository is not null && _savedCatalog is not null
        && SelectedComponent is not null && TryReadComponentTransform(out _);
    public string ModelRevisionLabel => _pinnedModel is null
        ? "Abra uma revisão publicada do modelo para editar o rosto."
        : HeadPart is null
            ? $"Modelo {_pinnedModel.Name} · revisão {_pinnedModel.Revision.Value} · nenhuma peça de cabeça reconhecida"
            : $"Modelo {_pinnedModel.Name} · revisão {_pinnedModel.Revision.Value}";
    public string CatalogStatus => HasMultipleCatalogs && SelectedCatalog is null
        ? "Escolha em qual catálogo facial salvar este par."
        : _savedCatalog is null
        ? "O próximo salvamento cria o catálogo facial deste modelo."
        : $"Catálogo “{_savedCatalog.Name}” · {_savedCatalog.Components.Length} componentes salvos";
    public string PublicationStatus => HasMultipleCatalogs && SelectedCatalog is null
        ? "Selecione um catálogo para consultar a publicação."
        : LatestPublication is null
        ? "Este catálogo ainda não tem uma publicação."
        : LatestPublication.DraftRevision == _savedCatalog?.Revision
            ? $"Publicado · revisão {LatestPublication.Revision.Value}"
            : $"Última publicação · revisão {LatestPublication.Revision.Value}; o rascunho atual tem mudanças";
    public string PublishButtonLabel => LatestPublication is null
        ? "Publicar catálogo facial"
        : "Publicar nova revisão facial";
    public string PreviewSummary => Preview is null ? string.Empty
        : $"{GetSheetLabel(Preview.Kind)} · {Preview.SourceWidth}×{Preview.SourceHeight} · {Preview.RemovedPixelCount:N0} pixels de fundo removidos · {Preview.Pieces.Count} recortes prontos para revisão";

    private static readonly FaceSheetKindChoiceItem[] FaceSheetKindChoices =
    [
        new(FaceSheetKind.Eyes, "Olhos, pupilas e olhos fechados"),
        new(FaceSheetKind.Eyebrows, "Sobrancelhas"),
        new(FaceSheetKind.Nose, "Nariz"),
        new(FaceSheetKind.MouthClosed, "Bocas fechadas"),
        new(FaceSheetKind.MouthOpen, "Bocas abertas")
    ];

    private static readonly FaceNoseSheetModeChoiceItem[] FaceNoseSheetModeChoices =
    [
        new(FaceNoseSheetMode.One, "Uma peça"),
        new(FaceNoseSheetMode.Six, "Seis peças"),
        new(FaceNoseSheetMode.Auto, "Detectar automaticamente")
    ];

    private static readonly FaceDetailKindChoiceItem[] FaceDetailKindChoices =
    [
        new(FaceDetailKind.EyeHighlightLeft, "Brilho olho esquerdo"),
        new(FaceDetailKind.EyeHighlightRight, "Brilho olho direito"),
        new(FaceDetailKind.Blush, "Blush"),
        new(FaceDetailKind.FacialShadow, "Sombra facial")
    ];

    private ModelPart? HeadPart => _pinnedModel?.Content.Parts.FirstOrDefault(part =>
        part.Name.Contains("cabe", StringComparison.OrdinalIgnoreCase)
        || part.Name.Contains("head", StringComparison.OrdinalIgnoreCase));

    partial void OnPreviewChanged(FaceSheetImportPreview? value) => OnPropertyChanged(nameof(PreviewSummary));

    partial void OnSelectedCatalogChanged(FaceCatalogChoiceItem? value)
    {
        _savedCatalog = value is not null && _catalogsById.TryGetValue(value.Id, out var catalog) ? catalog : null;
        if (SelectedFaceDetail is not null) SelectedFaceDetail = null;
        if (SelectedHeadExtra is not null) SelectedHeadExtra = null;
        _previewCatalogOverride = null;
        _previewingHeadExtra = false;
        _previewingFaceDetail = false;
        _gestureComponentId = null;
        _gestureStartTransform = null;
        LatestPublication = value is not null && _latestPublications.TryGetValue(value.Id, out var publication)
            ? publication : null;
        RefreshComponentChoices();
        OnPropertyChanged(nameof(CatalogStatus));
        OnPropertyChanged(nameof(HasSavedCatalog));
        OnPropertyChanged(nameof(CanConfirmImport));
        ConfirmImportCommand.NotifyCanExecuteChanged();
        PublishCatalogCommand.NotifyCanExecuteChanged();
        _ = RefreshComposedPreviewAsync();
    }

    partial void OnSelectedComponentChanged(FaceComponentChoiceItem? value)
    {
        if (value is null) return;
        var wasPreviewingHeadExtra = _previewingHeadExtra;
        var wasPreviewingFaceDetail = _previewingFaceDetail;
        if (SelectedFaceDetail is not null) SelectedFaceDetail = null;
        if (SelectedHeadExtra is not null) SelectedHeadExtra = null;
        _previewingHeadExtra = false;
        _previewingFaceDetail = false;
        _previewCatalogOverride = null;
        ComponentName = value.Name;
        ComponentX = FormatNumber(value.Transform.Translation.X);
        ComponentY = FormatNumber(value.Transform.Translation.Y);
        ComponentScaleX = FormatNumber(value.Transform.Scale.X);
        ComponentScaleY = FormatNumber(value.Transform.Scale.Y);
        ComponentRotation = FormatNumber(value.Transform.RotationRadians * 180d / Math.PI);
        if (wasPreviewingHeadExtra || wasPreviewingFaceDetail) _ = RefreshComposedPreviewAsync();
    }

    partial void OnSelectedHeadExtraChanged(HeadExtraChoiceItem? value)
    {
        if (value is null)
        {
            if (_previewingHeadExtra) _previewCatalogOverride = null;
            _previewingHeadExtra = false;
            _ = RefreshComposedPreviewAsync();
            return;
        }
        if (SelectedFaceDetail is not null) SelectedFaceDetail = null;
        _previewingFaceDetail = false;
        HeadExtraName = value.Name;
        HeadExtraX = FormatNumber(value.Transform.Translation.X);
        HeadExtraY = FormatNumber(value.Transform.Translation.Y);
        HeadExtraScaleX = FormatNumber(value.Transform.Scale.X);
        HeadExtraScaleY = FormatNumber(value.Transform.Scale.Y);
        HeadExtraRotation = FormatNumber(value.Transform.RotationRadians * 180d / Math.PI);
        UpdateHeadExtraPreview(value);
    }

    partial void OnSelectedFaceDetailChanged(FaceDetailChoiceItem? value)
    {
        if (value is null)
        {
            if (_previewingFaceDetail) _previewCatalogOverride = null;
            _previewingFaceDetail = false;
            _ = RefreshComposedPreviewAsync();
            return;
        }
        if (SelectedHeadExtra is not null) SelectedHeadExtra = null;
        _previewingHeadExtra = false;
        FaceDetailName = value.Name;
        FaceDetailX = FormatNumber(value.Transform.Translation.X);
        FaceDetailY = FormatNumber(value.Transform.Translation.Y);
        FaceDetailScaleX = FormatNumber(value.Transform.Scale.X);
        FaceDetailScaleY = FormatNumber(value.Transform.Scale.Y);
        FaceDetailRotation = FormatNumber(value.Transform.RotationRadians * 180d / Math.PI);
        UpdateFaceDetailPreview(value);
    }

    public async Task OpenModelRevisionAsync(PublishedModelRevision model, ModelSlot? modelSlot = null)
    {
        ArgumentNullException.ThrowIfNull(model);
        var slot = modelSlot ?? ModelSlot.From(1);
        if (_pinnedModel?.Id == model.Id && _headExtraModelSlot == slot) return;
        var discardedPreview = Preview is not null;
        await DisposePreviewAsync();
        var previousComposedFrame = ComposedPreviewFrame;
        ComposedPreviewFrame = null;
        previousComposedFrame?.Dispose();
        _pinnedModel = model;
        _headExtraModelSlot = slot;
        _headExtraLibrary = null;
        _faceDetailLibrary = null;
        _headExtraLibraryPersisted = false;
        _faceDetailLibraryPersisted = false;
        HeadExtraChoices.Clear();
        FaceDetailChoices.Clear();
        SelectedHeadExtra = null;
        SelectedFaceDetail = null;
        _savedCatalog = null;
        _previewCatalogOverride = null;
        _catalogsById.Clear();
        _latestPublications.Clear();
        CatalogChoices.Clear();
        OnPropertyChanged(nameof(HasMultipleCatalogs));
        SelectedCatalog = null;
        Error = null;
        Status = discardedPreview ? "A prévia anterior foi descartada ao trocar a revisão do modelo." : null;
        OnPropertyChanged(nameof(ModelRevisionLabel));
        OnPropertyChanged(nameof(CatalogStatus));
        OnPropertyChanged(nameof(HasSavedCatalog));
        OnPropertyChanged(nameof(CanSelectSheet));
        OnPropertyChanged(nameof(CanConfirmImport));
        OnPropertyChanged(nameof(HeadExtraLibraryCount));
        OnPropertyChanged(nameof(FaceDetailLibraryCount));
        SelectFaceSheetCommand.NotifyCanExecuteChanged();
        AddHeadExtraCommand.NotifyCanExecuteChanged();
        ImportFaceDetailCommand.NotifyCanExecuteChanged();
        await LoadHeadExtraLibraryAsync();
        await LoadFaceDetailLibraryAsync();
        RemoveSelectedComponentCommand.NotifyCanExecuteChanged();
        ConfirmImportCommand.NotifyCanExecuteChanged();
        await RefreshComposedPreviewAsync();
    }

    private async Task LoadHeadExtraLibraryAsync(CancellationToken cancellationToken = default)
    {
        if (_headExtraLibraryRepository is null) return;
        try
        {
            var loaded = await _headExtraLibraryRepository.GetAsync(_headExtraModelSlot, cancellationToken);
            if (loaded.IsSuccess)
            {
                _headExtraLibrary = loaded.Value;
                _headExtraLibraryPersisted = true;
            }
            else if (loaded.Error?.Code == ApplicationErrorCode.NotFound)
            {
                _headExtraLibrary = HeadExtraLibraryDraft.Create(_headExtraModelSlot);
                _headExtraLibraryPersisted = false;
            }
            else
            {
                Error = loaded.Error?.Message ?? "Não foi possível carregar a biblioteca de extras.";
                return;
            }
            RefreshHeadExtraChoices();
            OnPropertyChanged(nameof(HeadExtraLibraryCount));
            OnPropertyChanged(nameof(CanAddHeadExtra));
            AddHeadExtraCommand.NotifyCanExecuteChanged();
            Status = HeadExtraLibraryCount == 0
                ? $"Biblioteca de extras do slot {_headExtraModelSlot.Value:00} vazia."
                : $"{HeadExtraLibraryCount} extra(s) carregado(s) no slot {_headExtraModelSlot.Value:00}.";
        }
        catch (OperationCanceledException) { }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or ArgumentException)
        { Error = "Não foi possível carregar a biblioteca de extras desse slot."; }
    }

    private async Task LoadFaceDetailLibraryAsync(CancellationToken cancellationToken = default)
    {
        if (_faceDetailLibraryRepository is null) return;
        try
        {
            var loaded = await _faceDetailLibraryRepository.GetAsync(_headExtraModelSlot, cancellationToken);
            if (loaded.IsSuccess)
            {
                _faceDetailLibrary = loaded.Value;
                _faceDetailLibraryPersisted = true;
            }
            else if (loaded.Error?.Code == ApplicationErrorCode.NotFound)
            {
                _faceDetailLibrary = FaceDetailLibraryDraft.Create(_headExtraModelSlot);
                _faceDetailLibraryPersisted = false;
            }
            else { Error = loaded.Error?.Message ?? "Não foi possível carregar a biblioteca facial."; return; }
            RefreshFaceDetailChoices();
            OnPropertyChanged(nameof(FaceDetailLibraryCount));
            OnPropertyChanged(nameof(CanImportFaceDetail));
            ImportFaceDetailCommand.NotifyCanExecuteChanged();
            Status = FaceDetailLibraryCount == 0
                ? $"Biblioteca de detalhes faciais do slot {_headExtraModelSlot.Value:00} vazia."
                : $"{FaceDetailLibraryCount} detalhe(s) facial(is) carregado(s) no slot {_headExtraModelSlot.Value:00}.";
        }
        catch (OperationCanceledException) { }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or ArgumentException)
        { Error = "Não foi possível carregar a biblioteca de detalhes faciais desse slot."; }
    }

    private void RefreshHeadExtraChoices(FaceComponentId? selectedId = null)
    {
        HeadExtraChoices.Clear();
        if (_headExtraLibrary is not null)
            foreach (var asset in _headExtraLibrary.Assets.OrderBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase))
                HeadExtraChoices.Add(new HeadExtraChoiceItem(asset.Id, asset.AssetId, asset.Name, asset.Width, asset.Height, asset.DefaultTransform));
        SelectedHeadExtra = HeadExtraChoices.FirstOrDefault(item => item.Id == selectedId)
            ?? HeadExtraChoices.FirstOrDefault();
        OnPropertyChanged(nameof(HeadExtraLibraryCount));
        OnPropertyChanged(nameof(CanAddHeadExtra));
        OnPropertyChanged(nameof(CanSaveSelectedHeadExtra));
        OnPropertyChanged(nameof(CanRemoveSelectedHeadExtra));
        OnPropertyChanged(nameof(CanAddSelectedHeadExtraToCatalog));
        OnPropertyChanged(nameof(CanResetSelectedHeadExtra));
        AddHeadExtraCommand.NotifyCanExecuteChanged();
        SaveSelectedHeadExtraCommand.NotifyCanExecuteChanged();
        RemoveSelectedHeadExtraCommand.NotifyCanExecuteChanged();
        AddSelectedHeadExtraToCatalogCommand.NotifyCanExecuteChanged();
        ResetSelectedHeadExtraCommand.NotifyCanExecuteChanged();
    }

    private async Task<bool> PersistHeadExtraLibraryAsync(HeadExtraLibraryDraft updated,
        CancellationToken cancellationToken)
    {
        if (_headExtraLibraryRepository is null || _headExtraLibrary is null) return false;
        var result = _headExtraLibraryPersisted
            ? await _headExtraLibraryRepository.SaveAsync(updated, _headExtraLibrary.Revision, cancellationToken)
            : await _headExtraLibraryRepository.CreateAsync(updated, cancellationToken);
        if (result.IsFailure)
        {
            Error = result.Error!.Message;
            return false;
        }
        _headExtraLibrary = result.Value;
        _headExtraLibraryPersisted = true;
        return true;
    }

    private void RefreshFaceDetailChoices(FaceComponentId? selectedId = null)
    {
        FaceDetailChoices.Clear();
        if (_faceDetailLibrary is not null)
            foreach (var asset in _faceDetailLibrary.Assets.OrderBy(item => item.Kind).ThenBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase))
                FaceDetailChoices.Add(new FaceDetailChoiceItem(asset.Id, asset.AssetId, asset.Kind, asset.Name,
                    asset.Width, asset.Height, asset.Transform));
        SelectedFaceDetail = FaceDetailChoices.FirstOrDefault(item => item.Id == selectedId)
            ?? FaceDetailChoices.FirstOrDefault();
        OnPropertyChanged(nameof(FaceDetailLibraryCount));
        OnPropertyChanged(nameof(CanImportFaceDetail));
        OnPropertyChanged(nameof(CanSaveSelectedFaceDetail));
        OnPropertyChanged(nameof(CanResetSelectedFaceDetail));
        OnPropertyChanged(nameof(CanRemoveSelectedFaceDetail));
        OnPropertyChanged(nameof(CanAddSelectedFaceDetailToCatalog));
        ImportFaceDetailCommand.NotifyCanExecuteChanged();
        SaveSelectedFaceDetailCommand.NotifyCanExecuteChanged();
        ResetSelectedFaceDetailCommand.NotifyCanExecuteChanged();
        RemoveSelectedFaceDetailCommand.NotifyCanExecuteChanged();
        AddSelectedFaceDetailToCatalogCommand.NotifyCanExecuteChanged();
    }

    private async Task<bool> PersistFaceDetailLibraryAsync(FaceDetailLibraryDraft updated,
        CancellationToken cancellationToken)
    {
        if (_faceDetailLibraryRepository is null || _faceDetailLibrary is null) return false;
        var result = !_faceDetailLibraryPersisted
            ? await _faceDetailLibraryRepository.CreateAsync(updated, cancellationToken)
            : await _faceDetailLibraryRepository.SaveAsync(updated, _faceDetailLibrary.Revision, cancellationToken);
        if (result.IsFailure) { Error = result.Error!.Message; return false; }
        _faceDetailLibrary = result.Value;
        _faceDetailLibraryPersisted = true;
        return true;
    }

    private void UpdateHeadExtraPreview(HeadExtraChoiceItem item)
    {
        if (_pinnedModel is null) return;
        try
        {
            var component = FaceComponent.Restore(item.Id, FaceComponentKind.HeadExtra, item.Name, item.AssetId,
                null, item.Transform, true, zOrder: 800);
            var components = (_savedCatalog?.Components ?? [])
                .Where(existing => existing.Id != item.Id)
                .Append(component)
                .ToArray();
            _previewCatalogOverride = FaceCatalogDraft.Restore(_savedCatalog?.Id ?? FaceId.New(),
                ModelRevisionReference.From(_pinnedModel), _savedCatalog?.Revision ?? Revision.Initial,
                _savedCatalog?.Name ?? "Prévia de extra de cabeça", components);
            _previewingHeadExtra = true;
            _ = RefreshComposedPreviewAsync();
        }
        catch (ArgumentException)
        {
            ComposedPreviewError = "Não foi possível preparar a prévia deste extra de cabeça.";
        }
    }

    private void UpdateFaceDetailPreview(FaceDetailChoiceItem item)
    {
        if (_pinnedModel is null) return;
        try
        {
            var (kind, side) = MapFaceDetailKind(item.Kind);
            var component = FaceComponent.Restore(item.Id, kind, item.Name, item.AssetId, side,
                item.Transform, true, zOrder: FaceComponent.GetDefaultZOrder(kind));
            var components = (_savedCatalog?.Components ?? [])
                .Where(existing => existing.Id != item.Id)
                .Append(component)
                .ToArray();
            _previewCatalogOverride = FaceCatalogDraft.Restore(_savedCatalog?.Id ?? FaceId.New(),
                ModelRevisionReference.From(_pinnedModel), _savedCatalog?.Revision ?? Revision.Initial,
                _savedCatalog?.Name ?? "Prévia de detalhe facial", components);
            _previewingFaceDetail = true;
            _ = RefreshComposedPreviewAsync();
        }
        catch (ArgumentException)
        { ComposedPreviewError = "Não foi possível preparar a prévia deste detalhe facial."; }
    }

    public bool BeginComponentMoveGesture()
    {
        if (IsBusy) return false;
        if (_previewingFaceDetail && SelectedFaceDetail is not null && TryReadFaceDetailTransform(out var detailTransform))
        {
            _gestureComponentId = SelectedFaceDetail.Id;
            _gestureStartTransform = detailTransform;
            _gestureIsFaceDetail = true;
            _gestureIsHeadExtra = false;
        }
        else if (_previewingHeadExtra && SelectedHeadExtra is not null && TryReadHeadExtraTransform(out var extraTransform))
        {
            _gestureComponentId = SelectedHeadExtra.Id;
            _gestureStartTransform = extraTransform;
            _gestureIsHeadExtra = true;
            _gestureIsFaceDetail = false;
        }
        else if (SelectedComponent is not null && _savedCatalog is not null
            && TryReadComponentTransform(out var componentTransform))
        {
            _gestureComponentId = SelectedComponent.Id;
            _gestureStartTransform = componentTransform;
            _gestureIsHeadExtra = false;
            _gestureIsFaceDetail = false;
        }
        else if (SelectedHeadExtra is not null && TryReadHeadExtraTransform(out extraTransform))
        {
            _gestureComponentId = SelectedHeadExtra.Id;
            _gestureStartTransform = extraTransform;
            _gestureIsHeadExtra = true;
        }
        else return false;
        _gestureHasMoved = false;
        return true;
    }

    public async Task<bool> SelectComponentAtPreviewPointAsync(Point2D previewPoint,
        CancellationToken cancellationToken = default)
    {
        if (IsBusy || _pinnedModel is not { } model || _previewRenderer is null) return false;
        var catalog = _previewCatalogOverride ?? _savedCatalog;
        if (catalog is null) return false;
        FaceComponentId? componentId;
        try
        {
            componentId = await _previewRenderer.HitTestAsync(model, catalog, previewPoint,
                cancellationToken: cancellationToken);
        }
        catch (OperationCanceledException) { return false; }
        catch (Exception exception) when (exception is IOException or InvalidOperationException
                                          or InvalidDataException or ArgumentException)
        {
            Error = "Não foi possível identificar o componente na prévia facial.";
            return false;
        }

        if (componentId is not { } id || _pinnedModel?.Id != model.Id
            || (_previewCatalogOverride?.Id ?? _savedCatalog?.Id) != catalog.Id) return false;
        var catalogChoice = ComponentChoices.FirstOrDefault(choice => choice.Id == id);
        if (catalogChoice is not null)
        {
            SelectedHeadExtra = null;
            SelectedFaceDetail = null;
            SelectedComponent = catalogChoice;
            return true;
        }
        var detailChoice = FaceDetailChoices.FirstOrDefault(choice => choice.Id == id);
        if (detailChoice is not null)
        {
            SelectedHeadExtra = null;
            SelectedFaceDetail = detailChoice;
            return true;
        }
        var extraChoice = HeadExtraChoices.FirstOrDefault(choice => choice.Id == id);
        if (extraChoice is not null)
        {
            SelectedFaceDetail = null;
            SelectedHeadExtra = extraChoice;
            return true;
        }
        return false;
    }

    /// <summary>Updates the selected component's preview position using model-space deltas.</summary>
    public bool UpdateComponentMoveGesture(double deltaX, double deltaY)
    {
        if (_gestureComponentId is not { } componentId || _gestureStartTransform is not { } start
            || !double.IsFinite(deltaX) || !double.IsFinite(deltaY)) return false;
        if (_gestureIsHeadExtra)
        {
            if (SelectedHeadExtra?.Id != componentId) return false;
            var extraTransform = new Transform2D(new Point2D(start.Translation.X + deltaX, start.Translation.Y + deltaY),
                start.Scale, start.RotationRadians, start.Pivot, start.FlipX, start.FlipY);
            if (Math.Abs(extraTransform.Translation.X) > 100_000 || Math.Abs(extraTransform.Translation.Y) > 100_000) return false;
            HeadExtraX = FormatNumber(extraTransform.Translation.X);
            HeadExtraY = FormatNumber(extraTransform.Translation.Y);
            _gestureHasMoved = deltaX != 0 || deltaY != 0;
            UpdateHeadExtraPreview(SelectedHeadExtra with { Transform = extraTransform });
            return true;
        }
        if (_gestureIsFaceDetail)
        {
            if (SelectedFaceDetail?.Id != componentId) return false;
            var detailTransform = new Transform2D(new Point2D(start.Translation.X + deltaX, start.Translation.Y + deltaY),
                start.Scale, start.RotationRadians, start.Pivot, start.FlipX, start.FlipY);
            if (Math.Abs(detailTransform.Translation.X) > 100_000 || Math.Abs(detailTransform.Translation.Y) > 100_000) return false;
            FaceDetailX = FormatNumber(detailTransform.Translation.X);
            FaceDetailY = FormatNumber(detailTransform.Translation.Y);
            _gestureHasMoved = deltaX != 0 || deltaY != 0;
            UpdateFaceDetailPreview(SelectedFaceDetail with { Transform = detailTransform });
            return true;
        }
        if (_savedCatalog is null || SelectedComponent?.Id != componentId) return false;
        var transform = new Transform2D(new Point2D(start.Translation.X + deltaX, start.Translation.Y + deltaY),
            start.Scale, start.RotationRadians, start.Pivot, start.FlipX, start.FlipY);
        if (Math.Abs(transform.Translation.X) > 100_000 || Math.Abs(transform.Translation.Y) > 100_000) return false;

        ComponentX = FormatNumber(transform.Translation.X);
        ComponentY = FormatNumber(transform.Translation.Y);
        _gestureHasMoved = deltaX != 0 || deltaY != 0;
        _previewCatalogOverride = _savedCatalog.WithTransform(componentId, transform);
        _ = RefreshComposedPreviewAsync();
        return true;
    }

    public async Task<bool> CompleteComponentMoveGestureAsync(CancellationToken cancellationToken = default)
    {
        if (_gestureComponentId is null || _gestureStartTransform is null) return false;
        var hasMoved = _gestureHasMoved;
        var isHeadExtra = _gestureIsHeadExtra;
        var isFaceDetail = _gestureIsFaceDetail;
        _gestureComponentId = null;
        _gestureStartTransform = null;
        _gestureHasMoved = false;
        _gestureIsHeadExtra = false;
        _gestureIsFaceDetail = false;
        _previewCatalogOverride = null;
        if (!hasMoved) return true;
        if (isHeadExtra)
        {
            if (!CanSaveSelectedHeadExtra)
            {
                if (SelectedHeadExtra is not null) UpdateHeadExtraPreview(SelectedHeadExtra);
                return false;
            }
            await SaveSelectedHeadExtraAsync(cancellationToken);
            return !HasError;
        }
        if (isFaceDetail)
        {
            if (!CanSaveSelectedFaceDetail)
            {
                if (SelectedFaceDetail is not null) UpdateFaceDetailPreview(SelectedFaceDetail);
                return false;
            }
            await SaveSelectedFaceDetailAsync(cancellationToken);
            return !HasError;
        }
        if (!CanApplyComponentTransform)
        {
            _ = RefreshComposedPreviewAsync();
            return false;
        }
        await ApplyComponentTransformAsync(cancellationToken);
        return !HasError;
    }

    public void CancelComponentMoveGesture()
    {
        if (_gestureComponentId is null || _gestureStartTransform is not { } start) return;
        var isHeadExtra = _gestureIsHeadExtra;
        var isFaceDetail = _gestureIsFaceDetail;
        _gestureComponentId = null;
        _gestureStartTransform = null;
        _gestureHasMoved = false;
        _gestureIsHeadExtra = false;
        _gestureIsFaceDetail = false;
        _previewCatalogOverride = null;
        if (isHeadExtra)
        {
            HeadExtraX = FormatNumber(start.Translation.X);
            HeadExtraY = FormatNumber(start.Translation.Y);
            HeadExtraScaleX = FormatNumber(start.Scale.X);
            HeadExtraScaleY = FormatNumber(start.Scale.Y);
            HeadExtraRotation = FormatNumber(start.RotationRadians * 180d / Math.PI);
            if (SelectedHeadExtra is not null) UpdateHeadExtraPreview(SelectedHeadExtra);
            return;
        }
        if (isFaceDetail)
        {
            FaceDetailX = FormatNumber(start.Translation.X);
            FaceDetailY = FormatNumber(start.Translation.Y);
            FaceDetailScaleX = FormatNumber(start.Scale.X);
            FaceDetailScaleY = FormatNumber(start.Scale.Y);
            FaceDetailRotation = FormatNumber(start.RotationRadians * 180d / Math.PI);
            if (SelectedFaceDetail is not null) UpdateFaceDetailPreview(SelectedFaceDetail);
            return;
        }
        ComponentX = FormatNumber(start.Translation.X);
        ComponentY = FormatNumber(start.Translation.Y);
        ComponentScaleX = FormatNumber(start.Scale.X);
        ComponentScaleY = FormatNumber(start.Scale.Y);
        ComponentRotation = FormatNumber(start.RotationRadians * 180d / Math.PI);
        _ = RefreshComposedPreviewAsync();
    }

    public async Task LoadCatalogAsync(CancellationToken cancellationToken = default)
    {
        if (_pinnedModel is null || _catalogRepository is null) return;
        var result = await _catalogRepository.ListAsync(_pinnedModel.Id, cancellationToken);
        if (result.IsFailure)
        {
            Error = result.Error!.Message;
            return;
        }
        _catalogsById.Clear();
        CatalogChoices.Clear();
        foreach (var catalog in result.Value.OrderBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase)
                     .ThenByDescending(item => item.Revision.Value))
        {
            _catalogsById.Add(catalog.Id, catalog);
            CatalogChoices.Add(new FaceCatalogChoiceItem(catalog.Id, catalog.Name, catalog.Revision));
        }
        _latestPublications.Clear();
        foreach (var catalog in result.Value)
        {
            var publications = await _catalogRepository.ListPublishedAsync(catalog.Id, cancellationToken);
            if (publications.IsFailure)
            {
                Error = publications.Error!.Message;
                return;
            }
            var latest = publications.Value.OrderByDescending(publication => publication.Revision.Value).FirstOrDefault();
            if (latest is not null) _latestPublications[catalog.Id] = latest;
        }
        OnPropertyChanged(nameof(HasMultipleCatalogs));
        var selected = result.Value.Count == 1 ? result.Value[0] : null;
        SelectedCatalog = selected is null ? null
            : CatalogChoices.FirstOrDefault(choice => choice.Id == selected.Id);
        OnPropertyChanged(nameof(CatalogStatus));
        OnPropertyChanged(nameof(ModelRevisionLabel));
        OnPropertyChanged(nameof(CanSelectSheet));
        OnPropertyChanged(nameof(CanConfirmImport));
        SelectFaceSheetCommand.NotifyCanExecuteChanged();
        ConfirmImportCommand.NotifyCanExecuteChanged();
        Status = _savedCatalog is null ? "Nenhum catálogo facial salvo nesta revisão." : "Catálogo facial carregado.";
        await RefreshComposedPreviewAsync(cancellationToken);
    }

    [RelayCommand(CanExecute = nameof(CanSelectSheet))]
    private async Task SelectFaceSheetAsync(CancellationToken cancellationToken)
    {
        if (_filePicker is null || _importService is null || _pinnedModel is null) return;
        Error = null;
        Status = null;
        IsBusy = true;
        try
        {
            var file = await _filePicker.PickImageAsync(cancellationToken);
            if (file is null) return;
            await using var stream = file.Content;
            var options = new FaceSheetOptions(NoseMode: SelectedNoseSheetMode.Mode);
            var result = await _importService.PrepareAsync(stream, file.MediaType, SelectedSheetKind.Kind, options,
                cancellationToken: cancellationToken);
            if (result.IsFailure)
            {
                Error = result.Error!.Message;
                return;
            }

            await DisposePreviewAsync();
            Preview = result.Value;
            Status = $"Folha de {SelectedSheetKind.Label.ToLowerInvariant()} preparada: {Preview.Pieces.Count} recortes · {Preview.SourceWidth}×{Preview.SourceHeight}. Confira antes de salvar.";
        }
        catch (OperationCanceledException) { Status = "Importação facial cancelada."; }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or ArgumentException)
        { Error = "Não foi possível preparar a folha de sobrancelhas."; }
        finally { IsBusy = false; }
    }

    [RelayCommand(CanExecute = nameof(CanAddHeadExtra))]
    private async Task AddHeadExtraAsync(CancellationToken cancellationToken)
    {
        if (_filePicker is null || _headExtraImportService is null || _assetStore is null
            || _headExtraLibraryRepository is null || HeadPart is not { } head) return;
        Error = null;
        Status = null;
        IsBusy = true;
        try
        {
            var file = await _filePicker.PickImageAsync(cancellationToken);
            if (file is null) return;
            await using (file)
            {
                var prepared = await _headExtraImportService.PrepareAsync(file.Content, file.MediaType, cancellationToken);
                await using var png = new MemoryStream(prepared.PngBytes, writable: false);
                var imported = await _assetStore.ImportAsync(png, "image/png", cancellationToken);
                if (imported.IsFailure) { Error = imported.Error!.Message; return; }

                var baseName = Path.GetFileNameWithoutExtension(file.Name);
                var name = string.IsNullOrWhiteSpace(baseName) ? "Extra de cabeça" : baseName.Trim();
                if (name.Length > 120) name = name[..120];
                var transform = CreateInitialHeadExtraTransform(head, prepared.Width, prepared.Height);
                var extra = HeadExtraAsset.Create(imported.Value.Id, name, prepared.Width, prepared.Height, transform);
                var current = _headExtraLibrary ?? HeadExtraLibraryDraft.Create(_headExtraModelSlot);
                var candidate = _headExtraLibraryPersisted
                    ? current.WithAsset(extra)
                    : HeadExtraLibraryDraft.Restore(current.Id, _headExtraModelSlot, Revision.Initial, [extra]);
                if (!await PersistHeadExtraLibraryAsync(candidate, cancellationToken)) return;
                RefreshHeadExtraChoices(extra.Id);
                var chromaMessage = prepared.GreenKeyDetected
                    ? $" · fundo verde removido de {prepared.RemovedBackgroundPixels:N0} pixels"
                    : " · transparência preservada";
                Status = $"Extra “{name}” salvo na biblioteca do slot {_headExtraModelSlot.Value:00}{chromaMessage}.";
            }
        }
        catch (OperationCanceledException) { Status = "Importação do extra de cabeça cancelada."; }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException
                                          or InvalidDataException or InvalidOperationException or ArgumentException)
        { Error = "Não foi possível importar o extra de cabeça. Confira o arquivo e o espaço disponível."; }
        finally { IsBusy = false; }
    }

    [RelayCommand(CanExecute = nameof(CanImportFaceDetail))]
    private async Task ImportFaceDetailAsync(CancellationToken cancellationToken)
    {
        if (_filePicker is null || _faceDetailImportService is null || _assetStore is null
            || _faceDetailLibraryRepository is null || HeadPart is not { } head) return;
        Error = null;
        Status = null;
        IsBusy = true;
        try
        {
            var file = await _filePicker.PickImageAsync(cancellationToken);
            if (file is null) return;
            await using (file)
            {
                var prepared = await _faceDetailImportService.PrepareAsync(file.Content, file.MediaType, cancellationToken);
                await using var png = new MemoryStream(prepared.PngBytes, writable: false);
                var imported = await _assetStore.ImportAsync(png, "image/png", cancellationToken);
                if (imported.IsFailure) { Error = imported.Error!.Message; return; }
                var expectedSha256 = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(prepared.PngBytes))
                    .ToLowerInvariant();
                if (imported.Value.VerificationState != AssetVerificationState.Available
                    || imported.Value.ByteLength != prepared.PngBytes.Length
                    || !string.Equals(imported.Value.Sha256, expectedSha256, StringComparison.OrdinalIgnoreCase))
                { Error = "O AssetStore não confirmou o PNG preparado para o detalhe facial."; return; }

                var baseName = Path.GetFileNameWithoutExtension(file.Name);
                var fallback = SelectedFaceDetailKind.Label;
                var name = string.IsNullOrWhiteSpace(baseName) ? fallback : baseName.Trim();
                if (name.Length > 120) name = name[..120];
                var transform = CreateInitialFaceDetailTransform(head, SelectedFaceDetailKind.Kind,
                    prepared.Width, prepared.Height);
                var detail = FaceDetailAsset.Create(SelectedFaceDetailKind.Kind, imported.Value.Id, name,
                    prepared.Width, prepared.Height, transform);
                var current = _faceDetailLibrary ?? FaceDetailLibraryDraft.Create(_headExtraModelSlot);
                var candidate = _faceDetailLibraryPersisted
                    ? current.WithAsset(detail)
                    : FaceDetailLibraryDraft.Restore(current.Id, _headExtraModelSlot, Revision.Initial, [detail]);
                if (!await PersistFaceDetailLibraryAsync(candidate, cancellationToken)) return;
                RefreshFaceDetailChoices(detail.Id);
                Status = $"Detalhe “{name}” salvo na biblioteca do slot {_headExtraModelSlot.Value:00}.";
            }
        }
        catch (OperationCanceledException) { Status = "Importação do detalhe facial cancelada."; }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException
                                          or InvalidDataException or InvalidOperationException or ArgumentException)
        { Error = "Não foi possível importar o detalhe facial. Confira o arquivo e o espaço disponível."; }
        finally { IsBusy = false; }
    }

    [RelayCommand(CanExecute = nameof(CanSaveSelectedFaceDetail))]
    private async Task SaveSelectedFaceDetailAsync(CancellationToken cancellationToken)
    {
        if (_faceDetailLibrary is null || SelectedFaceDetail is null || !TryReadFaceDetailTransform(out var transform)) return;
        Error = null;
        IsBusy = true;
        try
        {
            var updated = FaceDetailAsset.Restore(SelectedFaceDetail.Id, SelectedFaceDetail.Kind,
                SelectedFaceDetail.AssetId, FaceDetailName.Trim(), SelectedFaceDetail.Width, SelectedFaceDetail.Height, transform);
            var candidate = _faceDetailLibrary.WithAsset(updated);
            if (!await PersistFaceDetailLibraryAsync(candidate, cancellationToken)) return;
            RefreshFaceDetailChoices(updated.Id);
            Status = $"Detalhe “{updated.Name}” salvo na biblioteca facial.";
        }
        catch (OperationCanceledException) { Status = "Edição cancelada; os dados salvos foram preservados."; }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or ArgumentException)
        { Error = "Não foi possível salvar o nome e o encaixe do detalhe facial."; }
        finally { IsBusy = false; }
    }

    [RelayCommand(CanExecute = nameof(CanResetSelectedFaceDetail))]
    private async Task ResetSelectedFaceDetailAsync(CancellationToken cancellationToken)
    {
        if (SelectedFaceDetail is null || HeadPart is not { } head) return;
        try
        {
            var transform = CreateInitialFaceDetailTransform(head, SelectedFaceDetail.Kind,
                SelectedFaceDetail.Width, SelectedFaceDetail.Height);
            FaceDetailX = FormatNumber(transform.Translation.X);
            FaceDetailY = FormatNumber(transform.Translation.Y);
            FaceDetailScaleX = FormatNumber(transform.Scale.X);
            FaceDetailScaleY = FormatNumber(transform.Scale.Y);
            FaceDetailRotation = FormatNumber(transform.RotationRadians * 180d / Math.PI);
            await SaveSelectedFaceDetailAsync(cancellationToken);
            if (!HasError) Status = $"Encaixe de “{FaceDetailName}” restaurado e salvo.";
        }
        catch (Exception exception) when (exception is InvalidDataException or ArgumentException)
        { Error = "Não foi possível calcular o encaixe inicial deste detalhe facial."; }
    }

    [RelayCommand(CanExecute = nameof(CanRemoveSelectedFaceDetail))]
    private async Task RemoveSelectedFaceDetailAsync(CancellationToken cancellationToken)
    {
        if (_faceDetailLibrary is null || SelectedFaceDetail is null) return;
        Error = null;
        IsBusy = true;
        try
        {
            var candidate = _faceDetailLibrary.WithoutAsset(SelectedFaceDetail.Id);
            if (!await PersistFaceDetailLibraryAsync(candidate, cancellationToken)) return;
            RefreshFaceDetailChoices();
            Status = "Detalhe removido da biblioteca. Referências já incluídas no catálogo facial permanecem protegidas.";
        }
        catch (OperationCanceledException) { Status = "Exclusão cancelada; a biblioteca facial salva foi preservada."; }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or ArgumentException)
        { Error = "Não foi possível remover o detalhe facial da biblioteca."; }
        finally { IsBusy = false; }
    }

    [RelayCommand(CanExecute = nameof(CanAddSelectedFaceDetailToCatalog))]
    private async Task AddSelectedFaceDetailToCatalogAsync(CancellationToken cancellationToken)
    {
        if (SelectedFaceDetail is null || _pinnedModel is null || _catalogRepository is null) return;
        Error = null;
        IsBusy = true;
        try
        {
            var (kind, side) = MapFaceDetailKind(SelectedFaceDetail.Kind);
            var component = FaceComponent.Restore(SelectedFaceDetail.Id, kind, SelectedFaceDetail.Name,
                SelectedFaceDetail.AssetId, side, SelectedFaceDetail.Transform, zOrder: FaceComponent.GetDefaultZOrder(kind));
            var candidate = _savedCatalog is null
                ? FaceCatalogDraft.Restore(FaceId.New(), ModelRevisionReference.From(_pinnedModel), Revision.Initial, "Rosto", [component])
                : _savedCatalog.WithComponent(component);
            var saved = _savedCatalog is null
                ? await _catalogRepository.CreateAsync(candidate, cancellationToken)
                : await _catalogRepository.SaveAsync(candidate, _savedCatalog.Revision, cancellationToken);
            if (saved.IsFailure) { Error = saved.Error!.Message; return; }
            AcceptSavedCatalog(saved.Value, component.Id);
            Status = $"“{component.Name}” adicionado à montagem facial. Publique o catálogo para usar no Customizador.";
        }
        catch (OperationCanceledException) { Status = "Inclusão no catálogo cancelada; a biblioteca facial foi preservada."; }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or ArgumentException)
        { Error = "Não foi possível adicionar o detalhe selecionado ao catálogo facial."; }
        finally { IsBusy = false; }
    }

    [RelayCommand(CanExecute = nameof(CanSaveSelectedHeadExtra))]
    private async Task SaveSelectedHeadExtraAsync(CancellationToken cancellationToken)
    {
        if (_headExtraLibrary is null || SelectedHeadExtra is null || !TryReadHeadExtraTransform(out var transform)) return;
        Error = null;
        IsBusy = true;
        try
        {
            var updated = HeadExtraAsset.Restore(SelectedHeadExtra.Id, SelectedHeadExtra.AssetId,
                HeadExtraName.Trim(), SelectedHeadExtra.Width, SelectedHeadExtra.Height, transform);
            var candidate = _headExtraLibrary.WithAsset(updated);
            if (!await PersistHeadExtraLibraryAsync(candidate, cancellationToken)) return;
            RefreshHeadExtraChoices(updated.Id);
            Status = $"“{updated.Name}” salvo na biblioteca de extras.";
        }
        catch (OperationCanceledException) { Status = "Edição cancelada; os dados salvos foram preservados."; }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or ArgumentException)
        { Error = "Não foi possível salvar o nome e o encaixe do extra."; }
        finally { IsBusy = false; }
    }

    [RelayCommand(CanExecute = nameof(CanResetSelectedHeadExtra))]
    private async Task ResetSelectedHeadExtraAsync(CancellationToken cancellationToken)
    {
        if (SelectedHeadExtra is null || HeadPart is not { } head) return;
        try
        {
            var transform = CreateInitialHeadExtraTransform(head, SelectedHeadExtra.Width, SelectedHeadExtra.Height);
            HeadExtraX = FormatNumber(transform.Translation.X);
            HeadExtraY = FormatNumber(transform.Translation.Y);
            HeadExtraScaleX = FormatNumber(transform.Scale.X);
            HeadExtraScaleY = FormatNumber(transform.Scale.Y);
            HeadExtraRotation = FormatNumber(transform.RotationRadians * 180d / Math.PI);
            await SaveSelectedHeadExtraAsync(cancellationToken);
            if (!HasError) Status = $"Encaixe de “{HeadExtraName}” restaurado e salvo.";
        }
        catch (Exception exception) when (exception is InvalidDataException or ArgumentException)
        { Error = "Não foi possível calcular o encaixe inicial deste extra."; }
    }

    [RelayCommand(CanExecute = nameof(CanRemoveSelectedHeadExtra))]
    private async Task RemoveSelectedHeadExtraAsync(CancellationToken cancellationToken)
    {
        if (_headExtraLibrary is null || SelectedHeadExtra is null) return;
        Error = null;
        IsBusy = true;
        try
        {
            var removedId = SelectedHeadExtra.Id;
            var candidate = _headExtraLibrary.WithoutAsset(removedId);
            if (!await PersistHeadExtraLibraryAsync(candidate, cancellationToken)) return;
            RefreshHeadExtraChoices();
            Status = "Extra removido da biblioteca. Se já estiver no catálogo facial, a montagem continua referenciando o asset.";
        }
        catch (OperationCanceledException) { Status = "Exclusão cancelada; a biblioteca salva foi preservada."; }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or ArgumentException)
        { Error = "Não foi possível remover o extra da biblioteca."; }
        finally { IsBusy = false; }
    }

    [RelayCommand(CanExecute = nameof(CanAddSelectedHeadExtraToCatalog))]
    private async Task AddSelectedHeadExtraToCatalogAsync(CancellationToken cancellationToken)
    {
        if (SelectedHeadExtra is null || _pinnedModel is null || _catalogRepository is null) return;
        Error = null;
        IsBusy = true;
        try
        {
            var visible = _savedCatalog?.Components.Any(component => component.Id == SelectedHeadExtra.Id && component.IsVisible)
                == true || VisibleHeadExtraCount < 8;
            var component = FaceComponent.Restore(SelectedHeadExtra.Id, FaceComponentKind.HeadExtra,
                SelectedHeadExtra.Name, SelectedHeadExtra.AssetId, null, SelectedHeadExtra.Transform,
                visible, zOrder: 800 + HeadExtraCount);
            var candidate = _savedCatalog is null
                ? FaceCatalogDraft.Restore(FaceId.New(), ModelRevisionReference.From(_pinnedModel), Revision.Initial, "Rosto", [component])
                : _savedCatalog.WithComponent(component);
            var saved = _savedCatalog is null
                ? await _catalogRepository.CreateAsync(candidate, cancellationToken)
                : await _catalogRepository.SaveAsync(candidate, _savedCatalog.Revision, cancellationToken);
            if (saved.IsFailure) { Error = saved.Error!.Message; return; }
            AcceptSavedCatalog(saved.Value, component.Id);
            Status = visible
                ? $"“{component.Name}” adicionado à montagem facial. Publique o catálogo para usar no Customizador."
                : "O catálogo já tem oito extras visíveis; o item foi adicionado oculto. Oculte outro antes de ativá-lo.";
        }
        catch (OperationCanceledException) { Status = "Inclusão no catálogo cancelada; a biblioteca foi preservada."; }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or ArgumentException)
        { Error = "Não foi possível adicionar o extra selecionado ao catálogo facial."; }
        finally { IsBusy = false; }
    }

    [RelayCommand(CanExecute = nameof(CanRemoveSelectedComponent))]
    private async Task RemoveSelectedComponentAsync(CancellationToken cancellationToken)
    {
        if (_savedCatalog is null || _catalogRepository is null || SelectedComponent is null) return;
        Error = null;
        Status = null;
        IsBusy = true;
        try
        {
            var componentId = SelectedComponent.Id;
            var updated = _savedCatalog.WithoutComponent(componentId);
            var saved = await _catalogRepository.SaveAsync(updated, _savedCatalog.Revision, cancellationToken);
            if (saved.IsFailure) { Error = saved.Error!.Message; return; }
            AcceptSavedCatalog(saved.Value);
            Status = "Componente removido do catálogo facial. O asset continua protegido pelo armazenamento central.";
        }
        catch (OperationCanceledException) { Status = "Remoção cancelada; o catálogo anterior foi preservado."; }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or ArgumentException)
        { Error = "Não foi possível remover o componente do catálogo facial."; }
        finally { IsBusy = false; }
    }

    [RelayCommand(CanExecute = nameof(CanToggleSelectedVisibility))]
    private async Task ToggleSelectedVisibilityAsync(CancellationToken cancellationToken)
    {
        if (_savedCatalog is null || _catalogRepository is null || SelectedComponent is null) return;
        Error = null;
        Status = null;
        IsBusy = true;
        try
        {
            var selected = _savedCatalog.Components.FirstOrDefault(component => component.Id == SelectedComponent.Id);
            if (selected is null) return;
            var updated = _savedCatalog.WithVisibility(selected.Id, !selected.IsVisible);
            var saved = await _catalogRepository.SaveAsync(updated, _savedCatalog.Revision, cancellationToken);
            if (saved.IsFailure) { Error = saved.Error!.Message; return; }
            AcceptSavedCatalog(saved.Value, selected.Id);
            Status = selected.IsVisible
                ? "Componente ocultado na prévia facial; ele continua salvo no catálogo."
                : "Componente exibido na prévia facial.";
        }
        catch (OperationCanceledException) { Status = "Alteração de visibilidade cancelada; o catálogo anterior foi preservado."; }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or ArgumentException)
        { Error = "Não foi possível alterar a visibilidade do componente facial."; }
        finally { IsBusy = false; }
    }

    [RelayCommand(CanExecute = nameof(CanApplyComponentName))]
    private async Task ApplyComponentNameAsync(CancellationToken cancellationToken)
    {
        if (_savedCatalog is null || _catalogRepository is null || SelectedComponent is null
            || !CanApplyComponentName) return;
        Error = null;
        Status = null;
        IsBusy = true;
        try
        {
            var componentId = SelectedComponent.Id;
            var updated = _savedCatalog.WithComponentName(componentId, ComponentName.Trim());
            var saved = await _catalogRepository.SaveAsync(updated, _savedCatalog.Revision, cancellationToken);
            if (saved.IsFailure) { Error = saved.Error!.Message; return; }
            AcceptSavedCatalog(saved.Value, componentId);
            Status = "Nome do componente facial salvo no catálogo.";
        }
        catch (OperationCanceledException) { Status = "Renomeação cancelada; o nome anterior foi preservado."; }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or ArgumentException)
        { Error = "Não foi possível salvar o nome do componente. Use até 120 caracteres."; }
        finally { IsBusy = false; }
    }

    private void AcceptSavedCatalog(FaceCatalogDraft catalog, FaceComponentId? selectedComponentId = null)
    {
        _savedCatalog = catalog;
        _catalogsById[catalog.Id] = catalog;
        var choiceIndex = -1;
        for (var index = 0; index < CatalogChoices.Count; index++)
            if (CatalogChoices[index].Id == catalog.Id) { choiceIndex = index; break; }
        var choice = new FaceCatalogChoiceItem(catalog.Id, catalog.Name, catalog.Revision);
        if (choiceIndex >= 0) CatalogChoices[choiceIndex] = choice;
        else CatalogChoices.Add(choice);
        OnPropertyChanged(nameof(HasMultipleCatalogs));
        OnPropertyChanged(nameof(HeadExtraCount));
        OnPropertyChanged(nameof(VisibleHeadExtraCount));
        OnPropertyChanged(nameof(CatalogStatus));
        OnPropertyChanged(nameof(PublicationStatus));
        OnPropertyChanged(nameof(HasSavedCatalog));
        SelectedCatalog = choice;
        RefreshComponentChoices();
        if (selectedComponentId is { } id)
            SelectedComponent = ComponentChoices.FirstOrDefault(component => component.Id == id);
        AddHeadExtraCommand.NotifyCanExecuteChanged();
        RemoveSelectedComponentCommand.NotifyCanExecuteChanged();
        ToggleSelectedVisibilityCommand.NotifyCanExecuteChanged();
        ApplyComponentNameCommand.NotifyCanExecuteChanged();
        PublishCatalogCommand.NotifyCanExecuteChanged();
    }

    [RelayCommand(CanExecute = nameof(CanConfirmImport))]
    private async Task ConfirmImportAsync(CancellationToken cancellationToken)
    {
        if (Preview is not { } preview || _pinnedModel is null || HeadPart is not { } head
            || _catalogRepository is null || _assetStore is null) return;
        Error = null;
        Status = null;
        IsBusy = true;
        try
        {
            var prepared = new List<(FaceSheetImportPiecePreview Piece, FaceComponentKind Kind,
                FaceComponentSide? Side, FaceMouthVariant MouthVariant, Transform2D Transform)>(preview.Pieces.Count);
            foreach (var piece in preview.Pieces)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var kind = MapComponentKind(piece.PartKind);
                FaceComponentSide? side = piece.Side is { } pieceSide ? pieceSide switch
                {
                    FaceSheetSide.Left => FaceComponentSide.Left,
                    FaceSheetSide.Right => FaceComponentSide.Right,
                    _ => throw new InvalidDataException("O recorte facial tem um lado desconhecido.")
                } : null;
                if ((kind is FaceComponentKind.Eye or FaceComponentKind.Pupil or FaceComponentKind.ClosedEye or FaceComponentKind.Eyebrow) != side.HasValue)
                    throw new InvalidDataException("O recorte facial não corresponde ao lado exigido pelo componente.");
                var mouthVariant = preview.Kind == FaceSheetKind.MouthOpen ? FaceMouthVariant.Open : FaceMouthVariant.Closed;
                var sharedScaleSource = kind is FaceComponentKind.Nose or FaceComponentKind.Mouth
                    ? preview.Pieces[0] : null;
                var transform = CreateInitialTransform(head, piece, kind, side, sharedScaleSource);
                if (transform.Scale.X > 20 || transform.Scale.Y > 20)
                {
                    Error = "Um recorte facial é pequeno demais para encaixar com segurança na cabeça deste modelo.";
                    return;
                }
                prepared.Add((piece, kind, side, mouthVariant, transform));
            }

            var components = new List<FaceComponent>(prepared.Count);
            foreach (var (piece, kind, side, mouthVariant, transform) in prepared)
            {
                cancellationToken.ThrowIfCancellationRequested();
                await using var stream = await piece.OpenPngReadAsync(cancellationToken);
                var imported = await _assetStore.ImportAsync(stream, "image/png", cancellationToken);
                if (imported.IsFailure) { Error = imported.Error!.Message; return; }
                if (imported.Value.VerificationState != AssetVerificationState.Available
                    || imported.Value.ByteLength != piece.PngByteLength
                    || !string.Equals(imported.Value.Sha256, piece.PngSha256, StringComparison.OrdinalIgnoreCase))
                {
                    Error = "O AssetStore retornou uma imagem diferente do lado revisado.";
                    return;
                }

                components.Add(FaceComponent.Create(kind, CreateComponentName(kind, side, piece.Index),
                    imported.Value.Id, side, transform, mouthVariant: kind == FaceComponentKind.Mouth
                        ? mouthVariant : FaceMouthVariant.Closed));
            }

            FaceCatalogDraft updated;
            Result<FaceCatalogDraft> persisted;
            if (_savedCatalog is null)
            {
                updated = FaceCatalogDraft.Restore(FaceId.New(), ModelRevisionReference.From(_pinnedModel),
                    Revision.Initial, "Rosto", components);
                persisted = await _catalogRepository.CreateAsync(updated, cancellationToken);
            }
            else
            {
                updated = FaceCatalogDraft.Restore(_savedCatalog.Id, _savedCatalog.Model,
                    _savedCatalog.Revision.Next(), _savedCatalog.Name,
                    _savedCatalog.Components.Where(component => !IsReplacedBySheet(component, preview.Kind))
                        .Concat(components));
                persisted = await _catalogRepository.SaveAsync(updated, _savedCatalog.Revision, cancellationToken);
            }

            if (persisted.IsFailure) { Error = persisted.Error!.Message; return; }
            _savedCatalog = persisted.Value;
            _catalogsById[persisted.Value.Id] = persisted.Value;
            var choiceIndex = -1;
            for (var index = 0; index < CatalogChoices.Count; index++)
                if (CatalogChoices[index].Id == persisted.Value.Id) { choiceIndex = index; break; }
            var choice = new FaceCatalogChoiceItem(persisted.Value.Id, persisted.Value.Name, persisted.Value.Revision);
            if (choiceIndex >= 0) CatalogChoices[choiceIndex] = choice;
            else CatalogChoices.Add(choice);
            OnPropertyChanged(nameof(HasMultipleCatalogs));
            SelectedCatalog = choice;
            await DisposePreviewAsync();
            OnPropertyChanged(nameof(CatalogStatus));
            Status = $"{components.Count} recortes de {GetSheetLabel(preview.Kind).ToLowerInvariant()} foram salvos no catálogo facial desta revisão.";
        }
        catch (OperationCanceledException) { Status = "Salvamento cancelado; o catálogo anterior foi preservado."; }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidOperationException or ArgumentException)
        { Error = "Não foi possível salvar as sobrancelhas no catálogo facial."; }
        finally { IsBusy = false; }
    }

    [RelayCommand]
    private async Task CancelImportAsync()
    {
        await DisposePreviewAsync();
        Error = null;
        Status = "Prévia descartada; nenhum catálogo foi alterado.";
    }

    [RelayCommand(CanExecute = nameof(CanPublishCatalog))]
    private async Task PublishCatalogAsync(CancellationToken cancellationToken)
    {
        if (_savedCatalog is not { Components.Length: > 0 } catalog || _catalogRepository is null) return;
        Error = null;
        Status = null;
        IsBusy = true;
        try
        {
            var result = await _catalogRepository.PublishAsync(catalog.Id, catalog.Revision,
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), cancellationToken);
            if (result.IsFailure)
            {
                Error = result.Error!.Message;
                return;
            }
            _latestPublications[catalog.Id] = result.Value;
            LatestPublication = result.Value;
            OnPropertyChanged(nameof(PublicationStatus));
            PublishCatalogCommand.NotifyCanExecuteChanged();
            Status = $"Catálogo facial publicado na revisão {result.Value.Revision.Value}.";
        }
        catch (OperationCanceledException) { Status = "Publicação cancelada; a revisão publicada anterior foi preservada."; }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or ArgumentException)
        { Error = "Não foi possível publicar o catálogo facial."; }
        finally { IsBusy = false; }
    }

    [RelayCommand(CanExecute = nameof(CanApplyComponentTransform))]
    private async Task ApplyComponentTransformAsync(CancellationToken cancellationToken)
    {
        if (_catalogRepository is null || _savedCatalog is null || SelectedComponent is null
            || !TryReadComponentTransform(out var transform)) return;
        Error = null;
        Status = null;
        IsBusy = true;
        try
        {
            var updated = _savedCatalog.WithTransform(SelectedComponent.Id, transform);
            var saved = await _catalogRepository.SaveAsync(updated, _savedCatalog.Revision, cancellationToken);
            if (saved.IsFailure)
            {
                Error = saved.Error!.Message;
                if (saved.Error.Code == ApplicationErrorCode.Conflict)
                    await RefreshAfterTransformConflictAsync(_savedCatalog.Id, SelectedComponent.Id,
                        [ComponentX, ComponentY, ComponentScaleX, ComponentScaleY, ComponentRotation], cancellationToken);
                return;
            }
            _savedCatalog = saved.Value;
            _catalogsById[saved.Value.Id] = saved.Value;
            var choiceIndex = -1;
            for (var index = 0; index < CatalogChoices.Count; index++)
                if (CatalogChoices[index].Id == saved.Value.Id) { choiceIndex = index; break; }
            var catalogChoice = new FaceCatalogChoiceItem(saved.Value.Id, saved.Value.Name, saved.Value.Revision);
            if (choiceIndex >= 0) CatalogChoices[choiceIndex] = catalogChoice;
            SelectedCatalog = catalogChoice;
            Status = $"Encaixe de {SelectedComponent.Label.ToLowerInvariant()} salvo no catálogo facial.";
        }
        catch (OperationCanceledException) { Status = "Ajuste cancelado; o catálogo anterior foi preservado."; }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException)
        { Error = "Confira posição, escala e rotação do componente facial."; }
        finally { IsBusy = false; }
    }

    private async Task RefreshAfterTransformConflictAsync(FaceId catalogId, FaceComponentId componentId,
        IReadOnlyList<string> pendingValues, CancellationToken cancellationToken)
    {
        if (_catalogRepository is null) return;
        var latest = await _catalogRepository.GetAsync(catalogId, cancellationToken);
        if (latest.IsFailure) return;
        _savedCatalog = latest.Value;
        _catalogsById[catalogId] = latest.Value;
        var index = -1;
        for (var item = 0; item < CatalogChoices.Count; item++)
            if (CatalogChoices[item].Id == catalogId) { index = item; break; }
        var choice = new FaceCatalogChoiceItem(catalogId, latest.Value.Name, latest.Value.Revision);
        if (index >= 0) CatalogChoices[index] = choice;
        SelectedCatalog = choice;
        SelectedComponent = ComponentChoices.FirstOrDefault(item => item.Id == componentId);
        if (SelectedComponent is null) return;
        ComponentX = pendingValues[0];
        ComponentY = pendingValues[1];
        ComponentScaleX = pendingValues[2];
        ComponentScaleY = pendingValues[3];
        ComponentRotation = pendingValues[4];
        Error = "O catálogo mudou em outra operação. A revisão atual foi carregada; confira o ajuste e salve novamente.";
    }

    private void RefreshComponentChoices()
    {
        var previousId = SelectedComponent?.Id;
        ComponentChoices.Clear();
        SelectedComponent = null;
        if (_savedCatalog is null) return;
        foreach (var component in _savedCatalog.Components.OrderBy(item => item.ZOrder).ThenBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase))
            ComponentChoices.Add(new FaceComponentChoiceItem(component.Id, CreateComponentLabel(component), component.Transform,
                component.Name, component.Kind, component.IsVisible));
        SelectedComponent = ComponentChoices.FirstOrDefault(choice => choice.Id == previousId) ?? ComponentChoices.FirstOrDefault();
        OnPropertyChanged(nameof(CanApplyComponentTransform));
        ApplyComponentTransformCommand.NotifyCanExecuteChanged();
    }

    private bool TryReadComponentTransform(out Transform2D transform)
    {
        transform = default;
        if (SelectedComponent is null || !TryNumber(ComponentX, out var x) || !TryNumber(ComponentY, out var y)
            || !TryNumber(ComponentScaleX, out var scaleX) || !TryNumber(ComponentScaleY, out var scaleY)
            || !TryNumber(ComponentRotation, out var rotationDegrees)
            || Math.Abs(x) > 100_000 || Math.Abs(y) > 100_000
            || scaleX is <= 0 or > 20 || scaleY is <= 0 or > 20 || Math.Abs(rotationDegrees) > 3600) return false;
        try
        {
            var original = SelectedComponent.Transform;
            transform = new Transform2D(new Point2D(x, y), new Point2D(scaleX, scaleY),
                rotationDegrees * Math.PI / 180d, original.Pivot, original.FlipX, original.FlipY);
            return true;
        }
        catch (ArgumentOutOfRangeException) { return false; }
    }

    private bool TryReadHeadExtraTransform(out Transform2D transform)
    {
        transform = default;
        if (SelectedHeadExtra is null || !TryNumber(HeadExtraX, out var x) || !TryNumber(HeadExtraY, out var y)
            || !TryNumber(HeadExtraScaleX, out var scaleX) || !TryNumber(HeadExtraScaleY, out var scaleY)
            || !TryNumber(HeadExtraRotation, out var rotationDegrees)
            || Math.Abs(x) > 100_000 || Math.Abs(y) > 100_000
            || scaleX is <= 0 or > 20 || scaleY is <= 0 or > 20 || Math.Abs(rotationDegrees) > 3600) return false;
        try
        {
            var original = SelectedHeadExtra.Transform;
            transform = new Transform2D(new Point2D(x, y), new Point2D(scaleX, scaleY),
                rotationDegrees * Math.PI / 180d, original.Pivot, original.FlipX, original.FlipY);
            return true;
        }
        catch (ArgumentOutOfRangeException) { return false; }
    }

    private bool TryReadFaceDetailTransform(out Transform2D transform)
    {
        transform = default;
        if (SelectedFaceDetail is null || !TryNumber(FaceDetailX, out var x) || !TryNumber(FaceDetailY, out var y)
            || !TryNumber(FaceDetailScaleX, out var scaleX) || !TryNumber(FaceDetailScaleY, out var scaleY)
            || !TryNumber(FaceDetailRotation, out var rotationDegrees)
            || Math.Abs(x) > 100_000 || Math.Abs(y) > 100_000
            || scaleX is <= 0 or > 20 || scaleY is <= 0 or > 20 || Math.Abs(rotationDegrees) > 3600) return false;
        try
        {
            var original = SelectedFaceDetail.Transform;
            transform = new Transform2D(new Point2D(x, y), new Point2D(scaleX, scaleY),
                rotationDegrees * Math.PI / 180d, original.Pivot, original.FlipX, original.FlipY);
            return true;
        }
        catch (ArgumentOutOfRangeException) { return false; }
    }

    private static Transform2D CreateInitialHeadExtraTransform(ModelPart head, int imageWidth, int imageHeight)
    {
        var sourceWidth = Math.Max(1, head.SourceCrop.Width);
        var sourceHeight = Math.Max(1, head.SourceCrop.Height);
        var scaleX = Math.Min(.6, sourceWidth * .55 / imageWidth);
        var scaleY = Math.Min(.35, sourceHeight * .30 / imageHeight);
        var modelPosition = head.Transform.Apply(new Point2D(sourceWidth * .5, sourceHeight * .75));
        return new Transform2D(modelPosition, new Point2D(scaleX, scaleY), 0,
            new Point2D(imageWidth / 2d, imageHeight / 2d));
    }

    private static Transform2D CreateInitialFaceDetailTransform(ModelPart head, FaceDetailKind kind,
        int imageWidth, int imageHeight)
    {
        var headWidth = head.SourceCrop.Width;
        var headHeight = head.SourceCrop.Height;
        if (headWidth <= 0 || headHeight <= 0 || imageWidth <= 0 || imageHeight <= 0)
            throw new InvalidDataException("A cabeça ou a imagem do detalhe facial não tem dimensões válidas.");
        var targetWidth = kind switch
        {
            FaceDetailKind.EyeHighlightLeft or FaceDetailKind.EyeHighlightRight => .075,
            FaceDetailKind.Blush => .24,
            FaceDetailKind.FacialShadow => .3,
            _ => throw new ArgumentOutOfRangeException(nameof(kind))
        };
        var x = kind switch
        {
            FaceDetailKind.EyeHighlightLeft => headWidth * .39,
            FaceDetailKind.EyeHighlightRight => headWidth * .61,
            _ => headWidth * .5
        };
        var yFromTop = kind switch
        {
            FaceDetailKind.EyeHighlightLeft or FaceDetailKind.EyeHighlightRight => headHeight * .48,
            FaceDetailKind.Blush => headHeight * .68,
            FaceDetailKind.FacialShadow => headHeight * .62,
            _ => throw new ArgumentOutOfRangeException(nameof(kind))
        };
        var scale = Math.Clamp(headWidth * targetWidth / imageWidth, .01, 20);
        var position = head.Transform.Apply(new Point2D(x, headHeight - yFromTop));
        return new Transform2D(position, new Point2D(scale, scale), 0,
            new Point2D(imageWidth / 2d, imageHeight / 2d));
    }

    private static (FaceComponentKind Kind, FaceComponentSide? Side) MapFaceDetailKind(FaceDetailKind kind) => kind switch
    {
        FaceDetailKind.EyeHighlightLeft => (FaceComponentKind.EyeHighlight, FaceComponentSide.Left),
        FaceDetailKind.EyeHighlightRight => (FaceComponentKind.EyeHighlight, FaceComponentSide.Right),
        FaceDetailKind.Blush => (FaceComponentKind.Blush, null),
        FaceDetailKind.FacialShadow => (FaceComponentKind.FacialShadow, null),
        _ => throw new ArgumentOutOfRangeException(nameof(kind))
    };

    private static bool TryNumber(string value, out double number) =>
        double.TryParse(value, NumberStyles.Float, CultureInfo.CurrentCulture, out number) && double.IsFinite(number);

    private static string FormatNumber(double value) => value.ToString("0.###", CultureInfo.CurrentCulture);

    private static string CreateComponentLabel(FaceComponent component)
    {
        var type = component.Kind switch
        {
            FaceComponentKind.Eye => "Olho", FaceComponentKind.Pupil => "Pupila",
            FaceComponentKind.ClosedEye => "Olho fechado", FaceComponentKind.Eyebrow => "Sobrancelha",
            FaceComponentKind.Nose => "Nariz", FaceComponentKind.Mouth => "Boca",
            FaceComponentKind.EyeHighlight => "Brilho do olho", FaceComponentKind.Blush => "Blush",
            FaceComponentKind.FacialShadow => "Sombra facial", FaceComponentKind.HeadExtra => "Extra de cabeça",
            _ => "Componente"
        };
        var side = component.Side switch { FaceComponentSide.Left => " esquerdo", FaceComponentSide.Right => " direito", _ => "" };
        return $"{type}{side} · {component.Name}";
    }

    private async Task DisposePreviewAsync()
    {
        var previous = Preview;
        Preview = null;
        if (previous is not null) await previous.DisposeAsync();
    }

    private async Task RefreshComposedPreviewAsync(CancellationToken cancellationToken = default)
    {
        if (_previewRenderer is null || _pinnedModel is null) return;

        var requestVersion = Interlocked.Increment(ref _composedPreviewVersion);
        var previousCancellation = Interlocked.Exchange(ref _composedPreviewCancellation,
            CancellationTokenSource.CreateLinkedTokenSource(cancellationToken));
        previousCancellation?.Cancel();
        previousCancellation?.Dispose();
        var request = _composedPreviewCancellation!;
        ComposedPreviewError = null;
        IsRenderingComposedPreview = true;
        try
        {
            var catalog = _previewCatalogOverride ?? _savedCatalog;
            var frame = await _previewRenderer.RenderAsync(_pinnedModel, catalog, 512, request.Token);
            if (request.IsCancellationRequested || requestVersion != Volatile.Read(ref _composedPreviewVersion))
            {
                frame.Dispose();
                return;
            }

            var previous = ComposedPreviewFrame;
            ComposedPreviewFrame = frame;
            previous?.Dispose();
        }
        catch (OperationCanceledException) when (request.IsCancellationRequested) { }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException
                                          or InvalidOperationException or InvalidDataException or ArgumentException)
        {
            if (requestVersion == Volatile.Read(ref _composedPreviewVersion))
                ComposedPreviewError = "Não foi possível compor a prévia facial. Confira os assets do modelo e do catálogo.";
        }
        finally
        {
            if (requestVersion == Volatile.Read(ref _composedPreviewVersion))
                IsRenderingComposedPreview = false;
            if (ReferenceEquals(Interlocked.CompareExchange(ref _composedPreviewCancellation, null, request), request))
                request.Dispose();
        }
    }

    private static Transform2D CreateInitialTransform(ModelPart head, FaceSheetImportPiecePreview piece,
        FaceComponentKind kind, FaceComponentSide? side, FaceSheetImportPiecePreview? sharedScaleSource = null)
    {
        var headWidth = head.SourceCrop.Width;
        var headHeight = head.SourceCrop.Height;
        if (headWidth <= 0 || headHeight <= 0)
            throw new InvalidDataException("A peça de cabeça não tem dimensões válidas para encaixar componentes faciais.");

        var centerX = kind switch
        {
            FaceComponentKind.Nose or FaceComponentKind.Mouth => headWidth * .5,
            _ => headWidth * (side == FaceComponentSide.Right
                ? kind == FaceComponentKind.Eyebrow ? .62 : .63
                : kind == FaceComponentKind.Eyebrow ? .38 : .37)
        };
        var centerYFromTop = kind switch
        {
            FaceComponentKind.Eyebrow => headHeight * .32,
            FaceComponentKind.Eye or FaceComponentKind.Pupil or FaceComponentKind.ClosedEye => headHeight * .46,
            FaceComponentKind.Nose => headHeight * .61,
            FaceComponentKind.Mouth => headHeight * .78,
            _ => headHeight * .46
        };
        var position = head.Transform.Apply(new Point2D(centerX, headHeight - centerYFromTop));
        var scaleSource = sharedScaleSource ?? piece;
        var (scaleX, scaleY) = kind switch
        {
            FaceComponentKind.Eyebrow => (headWidth * .16 / piece.Width, headHeight * .12 / piece.Height),
            FaceComponentKind.Eye or FaceComponentKind.ClosedEye => (headWidth * .19 / piece.Width, headHeight * .17 / piece.Height),
            FaceComponentKind.Pupil => (.35, .35),
            FaceComponentKind.Nose => (headWidth * .075 / scaleSource.Width, headWidth * .075 / scaleSource.Width),
            FaceComponentKind.Mouth => (headWidth * .2 / scaleSource.Width, headWidth * .2 / scaleSource.Width),
            _ => throw new InvalidDataException("Não há encaixe inicial definido para esta categoria facial.")
        };
        return new Transform2D(position, new Point2D(scaleX, scaleY), 0,
            new Point2D(piece.Width / 2d, piece.Height / 2d),
            flipX: kind == FaceComponentKind.Eyebrow && side == FaceComponentSide.Right);
    }

    private static string GetSheetLabel(FaceSheetKind kind) =>
        FaceSheetKindChoices.First(choice => choice.Kind == kind).Label;

    private static FaceComponentKind MapComponentKind(FaceSheetPartKind kind) => kind switch
    {
        FaceSheetPartKind.Eye => FaceComponentKind.Eye,
        FaceSheetPartKind.Pupil => FaceComponentKind.Pupil,
        FaceSheetPartKind.ClosedEye => FaceComponentKind.ClosedEye,
        FaceSheetPartKind.Eyebrow => FaceComponentKind.Eyebrow,
        FaceSheetPartKind.Nose => FaceComponentKind.Nose,
        FaceSheetPartKind.Mouth => FaceComponentKind.Mouth,
        _ => throw new InvalidDataException("O processador retornou uma categoria facial desconhecida.")
    };

    private static string CreateComponentName(FaceComponentKind kind, FaceComponentSide? side, int index)
    {
        var category = kind switch
        {
            FaceComponentKind.Eye => "Olho",
            FaceComponentKind.Pupil => "Pupila",
            FaceComponentKind.ClosedEye => "Olho fechado",
            FaceComponentKind.Eyebrow => "Sobrancelha",
            FaceComponentKind.Nose => "Nariz",
            FaceComponentKind.Mouth => "Boca",
            _ => "Componente facial"
        };
        return kind is FaceComponentKind.Mouth or FaceComponentKind.Nose
            ? $"{category} {index + 1:00}"
            : (category, side) switch
            {
                ("Olho", FaceComponentSide.Left) => "Olho esquerdo",
                ("Olho", FaceComponentSide.Right) => "Olho direito",
                ("Olho fechado", FaceComponentSide.Left) => "Olho fechado esquerdo",
                ("Olho fechado", FaceComponentSide.Right) => "Olho fechado direito",
                ("Pupila", FaceComponentSide.Left) => "Pupila esquerda",
                ("Pupila", FaceComponentSide.Right) => "Pupila direita",
                ("Sobrancelha", FaceComponentSide.Left) => "Sobrancelha esquerda",
                ("Sobrancelha", FaceComponentSide.Right) => "Sobrancelha direita",
                _ => category
            };
    }

    private static bool IsReplacedBySheet(FaceComponent component, FaceSheetKind kind) => kind switch
    {
        FaceSheetKind.Eyes => component.Kind is FaceComponentKind.Eye or FaceComponentKind.Pupil or FaceComponentKind.ClosedEye,
        FaceSheetKind.Eyebrows => component.Kind == FaceComponentKind.Eyebrow,
        FaceSheetKind.Nose => component.Kind == FaceComponentKind.Nose,
        FaceSheetKind.MouthClosed => component.Kind == FaceComponentKind.Mouth && component.MouthVariant == FaceMouthVariant.Closed,
        FaceSheetKind.MouthOpen => component.Kind == FaceComponentKind.Mouth && component.MouthVariant == FaceMouthVariant.Open,
        _ => false
    };

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        var previewCancellation = Interlocked.Exchange(ref _composedPreviewCancellation, null);
        previewCancellation?.Cancel();
        previewCancellation?.Dispose();
        ComposedPreviewFrame?.Dispose();
        ComposedPreviewFrame = null;
        IsRenderingComposedPreview = false;
        await DisposePreviewAsync();
    }
}

public sealed record FaceSheetKindChoiceItem(FaceSheetKind Kind, string Label);
public sealed record FaceNoseSheetModeChoiceItem(FaceNoseSheetMode Mode, string Label);

public sealed record FaceCatalogChoiceItem(FaceId Id, string Name, Revision Revision)
{
    public string Label => $"{Name} · rev. {Revision.Value}";
}

public sealed record FaceComponentChoiceItem(FaceComponentId Id, string Label, Transform2D Transform,
    string Name, FaceComponentKind Kind, bool IsVisible);

public sealed record HeadExtraChoiceItem(FaceComponentId Id, AssetId AssetId, string Name, int Width, int Height,
    Transform2D Transform)
{
    public string Label => Name;
}

public sealed record FaceDetailKindChoiceItem(FaceDetailKind Kind, string Label);

public sealed record FaceDetailChoiceItem(FaceComponentId Id, AssetId AssetId, FaceDetailKind Kind, string Name,
    int Width, int Height, Transform2D Transform)
{
    public string Label => $"{KindLabel(Kind)} · {Name}";

    private static string KindLabel(FaceDetailKind kind) => kind switch
    {
        FaceDetailKind.EyeHighlightLeft => "Brilho esquerdo",
        FaceDetailKind.EyeHighlightRight => "Brilho direito",
        FaceDetailKind.Blush => "Blush",
        FaceDetailKind.FacialShadow => "Sombra facial",
        _ => "Detalhe facial"
    };
}
