using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using System.Collections.ObjectModel;
using GV5.Application.Contracts;
using GV5.Assets.Processing;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using GV5.Modules.Fabricador.Import;

namespace GV5.Modules.Fabricador.ViewModels;

/// <summary>Owns staged facial-sheet review and persistence for one immutable model revision.</summary>
public partial class FaceWorkspaceViewModel : ObservableObject, IAsyncDisposable
{
    private readonly IFilePicker? _filePicker;
    private readonly FaceSheetImportService? _importService;
    private readonly IFaceCatalogRepository? _catalogRepository;
    private readonly IAssetStore? _assetStore;
    private PublishedModelRevision? _pinnedModel;
    private FaceCatalogDraft? _savedCatalog;
    private readonly Dictionary<FaceId, FaceCatalogDraft> _catalogsById = [];
    private readonly Dictionary<FaceId, PublishedFaceCatalogRevision> _latestPublications = [];
    private int _disposed;

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
    [NotifyPropertyChangedFor(nameof(CanSelectSheet))]
    [NotifyPropertyChangedFor(nameof(CanConfirmImport))]
    [NotifyPropertyChangedFor(nameof(CanChangeSheetKind))]
    [NotifyPropertyChangedFor(nameof(CanChangeNoseMode))]
    [NotifyCanExecuteChangedFor(nameof(SelectFaceSheetCommand))]
    [NotifyCanExecuteChangedFor(nameof(ConfirmImportCommand))]
    [NotifyCanExecuteChangedFor(nameof(PublishCatalogCommand))]
    private bool isBusy;

    public FaceWorkspaceViewModel(IFilePicker? filePicker, FaceSheetImportService? importService,
        IFaceCatalogRepository? catalogRepository = null, IAssetStore? assetStore = null)
    {
        _filePicker = filePicker;
        _importService = importService;
        _catalogRepository = catalogRepository;
        _assetStore = assetStore;
        CatalogChoices = [];
    }

    public bool HasPreview => Preview is not null;
    public bool HasError => !string.IsNullOrWhiteSpace(Error);
    public bool HasStatus => !string.IsNullOrWhiteSpace(Status);
    public bool CanChangeSheetKind => !HasPreview && !IsBusy;
    public bool HasMultipleCatalogs => CatalogChoices.Count > 1;
    public bool HasSavedCatalog => _savedCatalog is not null;
    public bool IsNoseSheetSelected => SelectedSheetKind.Kind == FaceSheetKind.Nose;
    public ObservableCollection<FaceCatalogChoiceItem> CatalogChoices { get; }
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
        LatestPublication = value is not null && _latestPublications.TryGetValue(value.Id, out var publication)
            ? publication : null;
        OnPropertyChanged(nameof(CatalogStatus));
        OnPropertyChanged(nameof(HasSavedCatalog));
        OnPropertyChanged(nameof(CanConfirmImport));
        ConfirmImportCommand.NotifyCanExecuteChanged();
        PublishCatalogCommand.NotifyCanExecuteChanged();
    }

    public async Task OpenModelRevisionAsync(PublishedModelRevision model)
    {
        ArgumentNullException.ThrowIfNull(model);
        if (_pinnedModel?.Id == model.Id) return;
        var discardedPreview = Preview is not null;
        await DisposePreviewAsync();
        _pinnedModel = model;
        _savedCatalog = null;
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

    private async Task DisposePreviewAsync()
    {
        var previous = Preview;
        Preview = null;
        if (previous is not null) await previous.DisposeAsync();
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
        await DisposePreviewAsync();
    }
}

public sealed record FaceSheetKindChoiceItem(FaceSheetKind Kind, string Label);
public sealed record FaceNoseSheetModeChoiceItem(FaceNoseSheetMode Mode, string Label);

public sealed record FaceCatalogChoiceItem(FaceId Id, string Name, Revision Revision)
{
    public string Label => $"{Name} · rev. {Revision.Value}";
}
