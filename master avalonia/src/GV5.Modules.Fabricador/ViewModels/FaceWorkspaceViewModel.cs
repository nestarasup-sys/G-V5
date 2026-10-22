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
    private FaceComponentChoiceItem? selectedComponent;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanApplyComponentTransform))]
    [NotifyCanExecuteChangedFor(nameof(ApplyComponentTransformCommand))]
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
    [NotifyCanExecuteChangedFor(nameof(SelectFaceSheetCommand))]
    [NotifyCanExecuteChangedFor(nameof(ConfirmImportCommand))]
    [NotifyCanExecuteChangedFor(nameof(PublishCatalogCommand))]
    [NotifyPropertyChangedFor(nameof(CanApplyComponentTransform))]
    [NotifyCanExecuteChangedFor(nameof(ApplyComponentTransformCommand))]
    private bool isBusy;

    public FaceWorkspaceViewModel(IFilePicker? filePicker, FaceSheetImportService? importService,
        IFaceCatalogRepository? catalogRepository = null, IAssetStore? assetStore = null,
        AssetImageDecoder? imageDecoder = null, IRenderSceneRenderer? sceneRenderer = null)
    {
        _filePicker = filePicker;
        _importService = importService;
        _catalogRepository = catalogRepository;
        _assetStore = assetStore;
        if (assetStore is not null && imageDecoder is not null && sceneRenderer is not null)
            _previewRenderer = new FaceCatalogPreviewRenderer(assetStore, imageDecoder, sceneRenderer);
        CatalogChoices = [];
        ComponentChoices = [];
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
    public bool IsNoseSheetSelected => SelectedSheetKind.Kind == FaceSheetKind.Nose;
    public ObservableCollection<FaceCatalogChoiceItem> CatalogChoices { get; }
    public ObservableCollection<FaceComponentChoiceItem> ComponentChoices { get; }
    public IReadOnlyList<FaceSheetKindChoiceItem> SheetKinds => FaceSheetKindChoices;
    public IReadOnlyList<FaceNoseSheetModeChoiceItem> NoseSheetModes => FaceNoseSheetModeChoices;
    public string SelectedSheetLabel => SelectedSheetKind.Label;
    public bool CanSelectSheet => !IsBusy && HeadPart is not null && _filePicker is not null && _importService is not null;
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

    private ModelPart? HeadPart => _pinnedModel?.Content.Parts.FirstOrDefault(part =>
        part.Name.Contains("cabe", StringComparison.OrdinalIgnoreCase)
        || part.Name.Contains("head", StringComparison.OrdinalIgnoreCase));

    partial void OnPreviewChanged(FaceSheetImportPreview? value) => OnPropertyChanged(nameof(PreviewSummary));

    partial void OnSelectedCatalogChanged(FaceCatalogChoiceItem? value)
    {
        _savedCatalog = value is not null && _catalogsById.TryGetValue(value.Id, out var catalog) ? catalog : null;
        _previewCatalogOverride = null;
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
        ComponentX = FormatNumber(value.Transform.Translation.X);
        ComponentY = FormatNumber(value.Transform.Translation.Y);
        ComponentScaleX = FormatNumber(value.Transform.Scale.X);
        ComponentScaleY = FormatNumber(value.Transform.Scale.Y);
        ComponentRotation = FormatNumber(value.Transform.RotationRadians * 180d / Math.PI);
    }

    public async Task OpenModelRevisionAsync(PublishedModelRevision model)
    {
        ArgumentNullException.ThrowIfNull(model);
        if (_pinnedModel?.Id == model.Id) return;
        var discardedPreview = Preview is not null;
        await DisposePreviewAsync();
        var previousComposedFrame = ComposedPreviewFrame;
        ComposedPreviewFrame = null;
        previousComposedFrame?.Dispose();
        _pinnedModel = model;
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
        SelectFaceSheetCommand.NotifyCanExecuteChanged();
        ConfirmImportCommand.NotifyCanExecuteChanged();
        await RefreshComposedPreviewAsync();
    }

    public bool BeginComponentMoveGesture()
    {
        if (IsBusy || _savedCatalog is null || SelectedComponent is null
            || !TryReadComponentTransform(out var transform)) return false;
        _gestureComponentId = SelectedComponent.Id;
        _gestureStartTransform = transform;
        _gestureHasMoved = false;
        return true;
    }

    /// <summary>Updates the selected component's preview position using model-space deltas.</summary>
    public bool UpdateComponentMoveGesture(double deltaX, double deltaY)
    {
        if (_gestureComponentId is not { } componentId || _gestureStartTransform is not { } start
            || _savedCatalog is null || SelectedComponent?.Id != componentId
            || !double.IsFinite(deltaX) || !double.IsFinite(deltaY)) return false;
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
        _gestureComponentId = null;
        _gestureStartTransform = null;
        _gestureHasMoved = false;
        _previewCatalogOverride = null;
        if (!hasMoved) return true;
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
        _gestureComponentId = null;
        _gestureStartTransform = null;
        _gestureHasMoved = false;
        _previewCatalogOverride = null;
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
            ComponentChoices.Add(new FaceComponentChoiceItem(component.Id, CreateComponentLabel(component), component.Transform));
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

public sealed record FaceComponentChoiceItem(FaceComponentId Id, string Label, Transform2D Transform);
