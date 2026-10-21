using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using GV5.Application.Contracts;
using GV5.Assets.Processing;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using GV5.Modules.Fabricador.Import;
using GV5.Modules.Fabricador.Interaction;
using SkiaSharp;

namespace GV5.Modules.Fabricador.ViewModels;

/// <summary>Owns import, chroma and role-tint preview state for the hair workspace.</summary>
public partial class HairWorkspaceViewModel : ObservableObject, IAsyncDisposable
{
    private readonly IFilePicker? _filePicker;
    private readonly HairSheetImportService? _importService;
    private readonly HairRoleTintProcessor? _tintProcessor;
    private readonly IHairStyleRepository? _hairRepository;
    private readonly IAssetStore? _assetStore;
    private readonly Dictionary<HairColorRole, SKColor> _overrides = [];
    private HairStyleEditorSession? _session;
    private PublishedModelRevision? _pinnedModel;
    private HairStyleDraft? _savedDraft;
    private HairStyleDraft? _baselineDraft;
    private bool _isNewDraftIntent;
    private HairPartOption _selectedBackPart = HairPartOption.BackHair;
    private CancellationTokenSource? _activeOperation;
    private TaskCompletionSource? _activeOperationCompletion;
    private int _disposed;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasPreview))]
    [NotifyPropertyChangedFor(nameof(PreviewDimensions))]
    [NotifyPropertyChangedFor(nameof(CanReprocess))]
    [NotifyPropertyChangedFor(nameof(CanCancel))]
    [NotifyPropertyChangedFor(nameof(CanEditDraftName))]
    [NotifyPropertyChangedFor(nameof(CanLoadDrafts))]
    [NotifyPropertyChangedFor(nameof(CanAddPosteriorLayer))]
    [NotifyPropertyChangedFor(nameof(CanAddTraseiroLayer))]
    [NotifyPropertyChangedFor(nameof(CanUndoLayer))]
    [NotifyPropertyChangedFor(nameof(CanRedoLayer))]
    [NotifyPropertyChangedFor(nameof(CanAddPosteriorLayer))]
    [NotifyPropertyChangedFor(nameof(CanAddTraseiroLayer))]
    [NotifyCanExecuteChangedFor(nameof(ReprocessCommand))]
    [NotifyCanExecuteChangedFor(nameof(CancelCommand))]
    [NotifyCanExecuteChangedFor(nameof(ApplyRoleColorCommand))]
    [NotifyCanExecuteChangedFor(nameof(ResetRoleColorCommand))]
    [NotifyCanExecuteChangedFor(nameof(ResetPaletteCommand))]
    [NotifyCanExecuteChangedFor(nameof(AddPosteriorLayerCommand))]
    [NotifyCanExecuteChangedFor(nameof(AddTraseiroLayerCommand))]
    [NotifyCanExecuteChangedFor(nameof(UndoLayerCommand))]
    [NotifyCanExecuteChangedFor(nameof(RedoLayerCommand))]
    [NotifyCanExecuteChangedFor(nameof(AddPosteriorLayerCommand))]
    [NotifyCanExecuteChangedFor(nameof(AddTraseiroLayerCommand))]
    private HairSheetImportPreview? preview;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SelectSheetCommand))]
    [NotifyCanExecuteChangedFor(nameof(ReprocessCommand))]
    [NotifyCanExecuteChangedFor(nameof(CancelCommand))]
    [NotifyCanExecuteChangedFor(nameof(ApplyRoleColorCommand))]
    [NotifyCanExecuteChangedFor(nameof(ResetRoleColorCommand))]
    [NotifyCanExecuteChangedFor(nameof(ResetPaletteCommand))]
    [NotifyPropertyChangedFor(nameof(CanSelectSheet))]
    [NotifyPropertyChangedFor(nameof(CanReprocess))]
    [NotifyPropertyChangedFor(nameof(CanCancel))]
    [NotifyCanExecuteChangedFor(nameof(SaveDraftCommand))]
    [NotifyCanExecuteChangedFor(nameof(PublishDraftCommand))]
    [NotifyCanExecuteChangedFor(nameof(NewDraftCommand))]
    private bool isBusy;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasError))]
    private string? error;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasStatus))]
    private string? status;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(ReprocessCommand))]
    private int tolerance = 70;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SaveDraftCommand))]
    [NotifyCanExecuteChangedFor(nameof(PublishDraftCommand))]
    private string draftName = "Novo cabelo";

    [ObservableProperty]
    private HairLayerListItem? selectedLayer;

    [ObservableProperty]
    private string layerX = "0";

    [ObservableProperty]
    private string layerY = "0";

    [ObservableProperty]
    private string layerScaleX = "1";

    [ObservableProperty]
    private string layerScaleY = "1";

    [ObservableProperty]
    private string layerRotation = "0";

    [ObservableProperty]
    private bool layerFlipX;

    private HairBackgroundModeOption _selectedMode = HairBackgroundModeOption.Auto;

    public HairWorkspaceViewModel(IFilePicker? filePicker, HairSheetImportService? importService,
        HairRoleTintProcessor? tintProcessor, IHairStyleRepository? hairRepository = null, IAssetStore? assetStore = null)
    {
        _filePicker = filePicker;
        _importService = importService;
        _tintProcessor = tintProcessor;
        _hairRepository = hairRepository;
        _assetStore = assetStore;
        RoleColors =
        [
            new(HairColorRole.Base, "Base", "#9B563E"),
            new(HairColorRole.Fade, "Degradê", "#633B37"),
            new(HairColorRole.Outline, "Contorno", "#392B33"),
            new(HairColorRole.Highlight, "Luzes", "#E5AD83"),
            new(HairColorRole.Accent, "Destaque", "#CF6391")
        ];
    }

    public void OpenModelRevision(PublishedModelRevision model)
    {
        ArgumentNullException.ThrowIfNull(model);
        if (_session is not null && _session.Draft.Model == ModelRevisionReference.From(model)) return;
        if (_session is not null)
        {
            Error = "Esta sessão está vinculada a outra revisão. Salve ou descarte as alterações antes de trocar o modelo.";
            return;
        }
        Error = null;
        _pinnedModel = model;
        _savedDraft = null;
        _isNewDraftIntent = false;
        _session = new HairStyleEditorSession(model);
        _baselineDraft = _session.Draft;
        DraftName = _session.Draft.Name;
        RebuildLayers();
        OnPropertyChanged(nameof(CanEditLayers));
        OnPropertyChanged(nameof(ModelRevisionLabel));
        OnPropertyChanged(nameof(EmptyLayerMessage));
        OnLayerSessionChanged();
        Status = "Sessão de camadas presa à revisão publicada; salve e publique para torná-la permanente.";
    }

    public async Task LoadSavedDraftsAsync(CancellationToken cancellationToken = default)
    {
        if (_hairRepository is null || _pinnedModel is null) return;
        var canReplaceCurrent = !IsDraftDirty;
        var result = await _hairRepository.ListAsync(_pinnedModel.Id, cancellationToken);
        if (result.IsFailure)
        {
            Error = result.Error!.Message;
            return;
        }
        SavedDrafts.Clear();
        foreach (var draft in result.Value.OrderByDescending(item => item.Revision.Value))
            SavedDrafts.Add(new HairDraftListItem(draft.Id, draft.Name, draft.Revision));
        OnPropertyChanged(nameof(HasSavedDrafts));
        if (canReplaceCurrent && SavedDrafts.Count > 0)
            await LoadDraftAsync(SavedDrafts[0], cancellationToken);
    }

    [RelayCommand(CanExecute = nameof(CanStartNewDraft))]
    private void NewDraft()
    {
        if (_pinnedModel is null || _session is null) return;
        _session = new HairStyleEditorSession(_pinnedModel);
        _savedDraft = null;
        _isNewDraftIntent = true;
        _baselineDraft = _session.Draft;
        DraftName = _session.Draft.Name;
        Error = null;
        RebuildLayers();
        OnPropertyChanged(nameof(IsDraftDirty));
        OnLayerSessionChanged();
        Status = "Novo penteado em rascunho. Salve para mantê-lo neste modelo.";
    }

    [RelayCommand(CanExecute = nameof(CanSaveDraft))]
    private async Task SaveDraftAsync()
    {
        if (_session is null || _hairRepository is null || _assetStore is null || _pinnedModel is null) return;
        Error = null;
        using var operation = BeginOperation();
        try
        {
            var result = await PersistDraftAsync(operation.Token);
            if (result.IsFailure) { Error = result.Error!.Message; return; }
            _savedDraft = result.Value;
            _baselineDraft = result.Value;
            _isNewDraftIntent = false;
            DraftName = result.Value.Name;
            await RefreshSavedDraftsAsync(operation.Token);
            Status = "Rascunho de cabelo salvo no banco de dados e com assets permanentes.";
        }
        catch (OperationCanceledException) { Status = "Salvamento cancelado; o rascunho salvo anteriormente foi preservado."; }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidOperationException or ArgumentException)
        { Error = "Não foi possível salvar o rascunho de cabelo."; }
        finally { EndOperation(operation); }
    }

    [RelayCommand(CanExecute = nameof(CanPublishDraft))]
    private async Task PublishDraftAsync()
    {
        if (_session is null || _hairRepository is null || _assetStore is null) return;
        Error = null;
        using var operation = BeginOperation();
        try
        {
            var saved = await PersistDraftAsync(operation.Token);
            if (saved.IsFailure) { Error = saved.Error!.Message; return; }
            _savedDraft = saved.Value;
            _baselineDraft = saved.Value;
            _isNewDraftIntent = false;
            var published = await _hairRepository.PublishAsync(saved.Value.Id, saved.Value.Revision,
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), operation.Token);
            if (published.IsFailure) { Error = published.Error!.Message; return; }
            await RefreshSavedDraftsAsync(operation.Token);
            Status = $"Penteado publicado como revisão {published.Value.Revision.Value}.";
        }
        catch (OperationCanceledException) { Status = "Publicação cancelada; o rascunho salvo permanece disponível."; }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidOperationException or ArgumentException)
        { Error = "Não foi possível publicar o penteado."; }
        finally { EndOperation(operation); }
    }

    [RelayCommand]
    private async Task LoadDraftAsync(HairDraftListItem? item, CancellationToken cancellationToken = default)
    {
        if (IsBusy || item is null || _hairRepository is null || _pinnedModel is null || _session is null) return;
        if (IsDraftDirty)
        {
            Error = "Salve o rascunho atual ou crie um novo antes de trocar de penteado.";
            return;
        }
        var result = await _hairRepository.GetAsync(item.Id, cancellationToken);
        if (result.IsFailure) { Error = result.Error!.Message; return; }
        if (result.Value.Model != ModelRevisionReference.From(_pinnedModel))
        {
            Error = "Este penteado pertence a outra revisão do modelo.";
            return;
        }
        _session = new HairStyleEditorSession(_pinnedModel, result.Value);
        _savedDraft = result.Value;
        _baselineDraft = result.Value;
        _isNewDraftIntent = false;
        DraftName = result.Value.Name;
        Error = null;
        RebuildLayers();
        OnPropertyChanged(nameof(IsDraftDirty));
        OnLayerSessionChanged();
    }

    public ObservableCollection<HairDraftListItem> SavedDrafts { get; } = [];
    public bool HasSavedDrafts => SavedDrafts.Count > 0;
    public bool IsDraftDirty => _session is not null && (_isNewDraftIntent
        || _baselineDraft is not null && (!ReferenceEquals(_session.Draft, _baselineDraft)
            || !string.Equals(DraftName.Trim(), _session.Draft.Name, StringComparison.Ordinal)));
    public bool CanStartNewDraft => !IsBusy && _session is not null && _pinnedModel is not null && !IsDraftDirty;
    public bool CanSaveDraft => !IsBusy && _session is not null && _hairRepository is not null && _assetStore is not null
        && (_savedDraft is null || IsDraftDirty);
    public bool CanPublishDraft => !IsBusy && _session is not null && _hairRepository is not null && _assetStore is not null;
    public bool CanEditDraftName => !IsBusy;
    public bool CanLoadDrafts => !IsBusy;
    public string DraftStateLabel => IsDraftDirty ? "Alterações não salvas" : _savedDraft is null ? "Novo rascunho" : $"Salvo · revisão {_savedDraft.Revision.Value}";

    [RelayCommand(CanExecute = nameof(CanAddPosteriorLayer))]
    private void AddPosteriorLayer()
    {
        if (_session is null || Preview is not { } preview) return;
        _session.AddOrReplace(HairLayer.Create(HairPartId.RearHair, preview.StagedPosteriorAssetId, Transform2D.Identity));
        _session.Select(HairPartId.RearHair);
        RebuildLayers();
        SelectedLayer = Layers.FirstOrDefault(item => item.Part == HairPartId.RearHair);
        OnLayerSessionChanged();
        Status = "Cabelo posterior adicionado à sessão; o PNG continua em staging até publicação.";
    }

    [RelayCommand(CanExecute = nameof(CanAddTraseiroLayer))]
    private void AddTraseiroLayer()
    {
        if (_session is null || Preview is not { } preview) return;
        _session.AddOrReplace(HairLayer.Create(SelectedBackPart.Part, preview.StagedTraseiroAssetId, Transform2D.Identity));
        _session.Select(SelectedBackPart.Part);
        RebuildLayers();
        SelectedLayer = Layers.FirstOrDefault(item => item.Part == SelectedBackPart.Part);
        OnLayerSessionChanged();
        Status = "Cabelo traseiro adicionado à sessão; o PNG continua em staging até publicação.";
    }

    [RelayCommand(CanExecute = nameof(CanUndoLayer))]
    private void UndoLayer()
    {
        if (_session?.Undo() != true) return;
        RebuildLayers();
        OnLayerSessionChanged();
    }

    [RelayCommand(CanExecute = nameof(CanRedoLayer))]
    private void RedoLayer()
    {
        if (_session?.Redo() != true) return;
        RebuildLayers();
        OnLayerSessionChanged();
    }

    [RelayCommand]
    private void MoveLayerUp(HairLayerListItem? item)
    {
        if (IsBusy || item is null || _session?.Move(item.Part, -1) != true) return;
        RebuildLayers();
        OnLayerSessionChanged();
    }

    [RelayCommand]
    private void MoveLayerDown(HairLayerListItem? item)
    {
        if (IsBusy || item is null || _session?.Move(item.Part, 1) != true) return;
        RebuildLayers();
        OnLayerSessionChanged();
    }

    [RelayCommand]
    private void RemoveLayer(HairLayerListItem? item)
    {
        if (IsBusy || item is null || _session?.Remove(item.Part) != true) return;
        RebuildLayers();
        OnLayerSessionChanged();
    }

    [RelayCommand]
    private void ToggleLayerVisibility(HairLayerListItem? item)
    {
        if (IsBusy || item is null || _session?.SetVisibility(item.Part, !item.IsVisible) != true) return;
        RebuildLayers();
        OnLayerSessionChanged();
    }

    [RelayCommand]
    private void SelectLayer(HairLayerListItem? item)
    {
        if (IsBusy || item is null || !Layers.Contains(item)) return;
        SelectedLayer = item;
        _session?.Select(item.Part);
    }

    [RelayCommand]
    private void ApplyLayerTransform()
    {
        if (IsBusy || _session is null || SelectedLayer is not { } selected) return;
        if (!TryParseNumber(LayerX, out var x) || !TryParseNumber(LayerY, out var y)
            || !TryParseNumber(LayerScaleX, out var scaleX) || !TryParseNumber(LayerScaleY, out var scaleY)
            || !TryParseNumber(LayerRotation, out var rotation))
        {
            Error = "Posição, escala e rotação precisam ser números válidos.";
            return;
        }

        try
        {
            var current = selected.Transform;
            var transform = new Transform2D(new Point2D(x, y), new Point2D(scaleX, scaleY),
                rotation * Math.PI / 180d, current.Pivot, LayerFlipX, current.FlipY);
            if (!_session.SetTransform(selected.Part, transform)) return;
            Error = null;
            RebuildLayers();
            OnLayerSessionChanged();
            Status = "Transformação aplicada à camada selecionada.";
        }
        catch (ArgumentOutOfRangeException)
        {
            Error = "Use posição entre −100.000 e 100.000 e escala maior que 0 e até 20.";
        }
    }

    [RelayCommand]
    private void ResetLayerTransform()
    {
        if (IsBusy || _session is null || SelectedLayer is not { } selected) return;
        if (!_session.SetTransform(selected.Part, Transform2D.Identity)) return;
        RebuildLayers();
        OnLayerSessionChanged();
        Status = "Transformação da camada restaurada.";
    }

    public ObservableCollection<HairRoleColorItem> RoleColors { get; }
    public ObservableCollection<HairLayerListItem> Layers { get; } = [];
    public IReadOnlyList<HairPartOption> BackPartOptions { get; } = [HairPartOption.BackHair, HairPartOption.Ponytail];
    public HairPartOption SelectedBackPart
    {
        get => _selectedBackPart;
        set => SetProperty(ref _selectedBackPart, value);
    }
    public IReadOnlyList<HairBackgroundModeOption> Modes { get; } =
    [HairBackgroundModeOption.Auto, HairBackgroundModeOption.Green, HairBackgroundModeOption.Checker];
    public HairBackgroundModeOption SelectedMode
    {
        get => _selectedMode;
        set
        {
            if (SetProperty(ref _selectedMode, value) && Preview is not null)
                Status = "Opção de chroma alterada; reprocesse para ver o resultado.";
        }
    }
    public HairRoleTintResult? PosteriorTint { get; private set; }
    public HairRoleTintResult? TraseiroTint { get; private set; }
    public bool HasPreview => Preview is not null;
    public bool HasError => !string.IsNullOrWhiteSpace(Error);
    public bool HasStatus => !string.IsNullOrWhiteSpace(Status);
    public bool CanSelectSheet => !IsBusy && _filePicker is not null && _importService is not null;
    public bool CanReprocess => !IsBusy && Preview is not null && _importService is not null;
    public bool CanCancel => IsBusy || Preview is not null;
    public bool CanEditLayers => _session is not null;
    public bool CanAddPosteriorLayer => CanEditLayers && Preview is not null && !IsBusy;
    public bool CanAddTraseiroLayer => CanEditLayers && Preview is not null && !IsBusy;
    public bool CanUndoLayer => _session?.CanUndo == true && !IsBusy;
    public bool CanRedoLayer => _session?.CanRedo == true && !IsBusy;
    public bool HasNoLayers => Layers.Count == 0;
    public bool HasSelectedLayer => SelectedLayer is not null;
    public string SelectedLayerLabel => SelectedLayer?.Label ?? "Selecione uma camada para editar o encaixe.";
    public string EmptyLayerMessage => CanEditLayers ? "Nenhuma camada foi adicionada a esta sessão." : ModelRevisionLabel;
    public string ModelRevisionLabel => _session is { } session
        ? $"Modelo {session.Draft.Model.ModelId} · revisão {session.Draft.Model.Sequence.Value:00}"
        : "Salve e publique um modelo para editar camadas de cabelo.";
    public string PreviewDimensions => Preview is { } source
        ? $"Folha original {source.SourceWidth} × {source.SourceHeight} px · Posterior {source.PosteriorWidth} × {source.PosteriorHeight} px · Traseiro {source.TraseiroWidth} × {source.TraseiroHeight} px"
        : string.Empty;

    [RelayCommand(CanExecute = nameof(CanSelectSheet))]
    private async Task SelectSheetAsync()
    {
        if (_filePicker is null || _importService is null) return;
        Error = null;
        Status = null;
        using var operation = BeginOperation();
        try
        {
            await using var selected = await _filePicker.PickImageAsync(operation.Token);
            if (selected is null) return;
            await PrepareAsync(selected.Content, selected.MediaType, operation.Token);
        }
        catch (OperationCanceledException)
        {
            Status = "Importação cancelada; a folha original foi mantida.";
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidOperationException or ArgumentException)
        {
            Error = "Não foi possível abrir ou preparar essa folha de cabelo.";
        }
        finally { EndOperation(operation); }
    }

    [RelayCommand(CanExecute = nameof(CanReprocess))]
    private async Task ReprocessAsync()
    {
        if (Preview is not { } current || _importService is null) return;
        Error = null;
        using var operation = BeginOperation();
        try
        {
            Result<HairSheetImportPreview> result;
            await using (var original = await current.OpenOriginalReadAsync(operation.Token))
                result = await _importService.PrepareAsync(original, current.OriginalMediaType,
                    new HairSheetOptions(Tolerance, SelectedMode.Mode), operation.Token);
            await AcceptResultAsync(result, operation.Token);
        }
        catch (OperationCanceledException)
        {
            Status = "Reprocessamento cancelado; a prévia anterior permaneceu intacta.";
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            Error = "Não foi possível reaplicar o chroma sobre a folha original.";
        }
        finally { EndOperation(operation); }
    }

    [RelayCommand(CanExecute = nameof(CanCancel))]
    private async Task CancelAsync()
    {
        if (_activeOperation is { } operation)
        {
            operation.Cancel();
            Status = "Cancelando processamento…";
            return;
        }
        if (Preview is { } stagedPreview) RemoveStagedLayers(stagedPreview);
        await ClearPreviewAsync();
        Error = null;
        Status = "Prévia descartada; o arquivo original não foi alterado.";
    }

    [RelayCommand(CanExecute = nameof(CanChangePalette))]
    private async Task ApplyRoleColorAsync(HairRoleColorItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        if (!TryParseHex(item.HexColor, out var color))
        {
            Error = $"A cor de {item.Label} precisa usar o formato #RRGGBB.";
            return;
        }
        Error = null;
        _overrides[item.Role] = color;
        item.IsOverridden = true;
        using var operation = BeginOperation();
        try
        {
            await RefreshTintAsync(operation.Token);
            _session?.SetColor(item.Role, PackRgb(color));
            OnLayerSessionChanged();
        }
        catch (OperationCanceledException) { Status = "Atualização de cor cancelada."; }
        catch (Exception exception) when (exception is InvalidOperationException or ArgumentException or IOException)
        { Error = "Não foi possível aplicar a paleta à prévia."; }
        finally { EndOperation(operation); }
    }

    [RelayCommand(CanExecute = nameof(CanChangePalette))]
    private async Task ResetRoleColorAsync(HairRoleColorItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        _overrides.Remove(item.Role);
        item.IsOverridden = false;
        using var operation = BeginOperation();
        try
        {
            await RefreshTintAsync(operation.Token);
            _session?.ClearColor(item.Role);
            OnLayerSessionChanged();
        }
        catch (OperationCanceledException) { Status = "Atualização de cor cancelada."; }
        catch (Exception exception) when (exception is InvalidOperationException or ArgumentException or IOException)
        { Error = "Não foi possível restaurar esta cor na prévia."; }
        finally { EndOperation(operation); }
    }

    [RelayCommand(CanExecute = nameof(CanChangePalette))]
    private async Task ResetPaletteAsync()
    {
        _overrides.Clear();
        foreach (var role in RoleColors) role.IsOverridden = false;
        using var operation = BeginOperation();
        try
        {
            await RefreshTintAsync(operation.Token);
            if (_session is not null)
                foreach (var role in Enum.GetValues<HairColorRole>()) _session.ClearColor(role);
            OnLayerSessionChanged();
        }
        catch (OperationCanceledException) { Status = "Restauração da paleta cancelada."; }
        catch (Exception exception) when (exception is InvalidOperationException or ArgumentException or IOException)
        { Error = "Não foi possível restaurar a paleta na prévia."; }
        finally { EndOperation(operation); }
    }

    private bool CanChangePalette() => !IsBusy && Preview is not null && _tintProcessor is not null;

    private async Task<Result<HairStyleDraft>> PersistDraftAsync(CancellationToken cancellationToken)
    {
        if (_session is null || _hairRepository is null || _assetStore is null)
            return Result<HairStyleDraft>.Failure(new ApplicationError(ApplicationErrorCode.Validation,
                "A persistência do cabelo não está configurada."));

        if (!string.Equals(_session.Draft.Name, DraftName.Trim(), StringComparison.Ordinal))
            _session.Rename(DraftName);

        var permanentAssets = await ImportReferencedStagedAssetsAsync(cancellationToken);
        if (permanentAssets.IsFailure) return Result<HairStyleDraft>.Failure(permanentAssets.Error!);
        if (permanentAssets.Value.Count > 0)
        {
            _session.ReconcileAssetReferences(permanentAssets.Value, new HashSet<AssetId>());
            RebuildLayers();
            OnPropertyChanged(nameof(IsDraftDirty));
            OnLayerSessionChanged();
        }

        var draft = _session.Draft;
        if (_savedDraft is null)
        {
            var initial = HairStyleDraft.Restore(draft.Id, draft.Model, Revision.Initial, draft.Name,
                draft.Layers, draft.Palette);
            var created = await _hairRepository.CreateAsync(initial, cancellationToken);
            if (created.IsFailure) return created;
            _savedDraft = created.Value;
            if (draft.Revision == Revision.Initial) return created;
            var firstEdit = await _hairRepository.SaveAsync(draft, created.Value.Revision, cancellationToken);
            if (firstEdit.IsFailure) return firstEdit;
            return firstEdit;
        }

        if (!IsDraftDirty) return Result<HairStyleDraft>.Success(_savedDraft);
        return await _hairRepository.SaveAsync(draft, _savedDraft.Revision, cancellationToken);
    }

    private async Task<Result<Dictionary<AssetId, AssetId>>> ImportReferencedStagedAssetsAsync(CancellationToken cancellationToken)
    {
        var replacements = new Dictionary<AssetId, AssetId>();
        if (_session is null || _assetStore is null) return Result<Dictionary<AssetId, AssetId>>.Success(replacements);
        foreach (var stagedId in _session.Draft.Layers.Select(layer => layer.AssetId).Distinct())
        {
            cancellationToken.ThrowIfCancellationRequested();
            var existing = await _assetStore.GetMetadataAsync(stagedId, cancellationToken);
            if (existing.IsSuccess && existing.Value.VerificationState == AssetVerificationState.Available) continue;

            if (Preview is not { } preview)
                return Result<Dictionary<AssetId, AssetId>>.Failure(new ApplicationError(ApplicationErrorCode.NotFound,
                    "Uma camada aponta para um PNG temporário que já não está disponível. Reimporte a folha para recuperá-la."));

            Stream? content = null;
            string expectedHash;
            long expectedLength;
            if (stagedId == preview.StagedPosteriorAssetId)
            {
                content = await preview.OpenPosteriorPngReadAsync(cancellationToken);
                expectedHash = preview.PosteriorPngSha256;
                expectedLength = preview.PosteriorPngByteLength;
            }
            else if (stagedId == preview.StagedTraseiroAssetId)
            {
                content = await preview.OpenTraseiroPngReadAsync(cancellationToken);
                expectedHash = preview.TraseiroPngSha256;
                expectedLength = preview.TraseiroPngByteLength;
            }
            else
            {
                return Result<Dictionary<AssetId, AssetId>>.Failure(new ApplicationError(ApplicationErrorCode.NotFound,
                    "Uma camada temporária não corresponde à folha de cabelo atualmente preparada."));
            }

            await using (content)
            {
                var imported = await _assetStore.ImportAsync(content, "image/png", cancellationToken);
                if (imported.IsFailure) return Result<Dictionary<AssetId, AssetId>>.Failure(imported.Error!);
                var metadata = imported.Value;
                if (metadata.VerificationState != AssetVerificationState.Available
                    || !string.Equals(metadata.MediaType, "image/png", StringComparison.OrdinalIgnoreCase)
                    || metadata.ByteLength != expectedLength
                    || !string.Equals(metadata.Sha256, expectedHash, StringComparison.OrdinalIgnoreCase))
                    return Result<Dictionary<AssetId, AssetId>>.Failure(new ApplicationError(ApplicationErrorCode.Persistence,
                        "O AssetStore retornou um PNG diferente do recorte aprovado."));
                replacements.Add(stagedId, metadata.Id);
            }
        }
        return Result<Dictionary<AssetId, AssetId>>.Success(replacements);
    }

    private async Task RefreshSavedDraftsAsync(CancellationToken cancellationToken)
    {
        if (_hairRepository is null || _pinnedModel is null) return;
        var result = await _hairRepository.ListAsync(_pinnedModel.Id, cancellationToken);
        if (result.IsFailure) { Error = result.Error!.Message; return; }
        SavedDrafts.Clear();
        foreach (var draft in result.Value.OrderByDescending(item => item.Revision.Value))
            SavedDrafts.Add(new HairDraftListItem(draft.Id, draft.Name, draft.Revision));
        OnPropertyChanged(nameof(HasSavedDrafts));
        OnPropertyChanged(nameof(IsDraftDirty));
        OnPropertyChanged(nameof(DraftStateLabel));
        SaveDraftCommand.NotifyCanExecuteChanged();
        PublishDraftCommand.NotifyCanExecuteChanged();
        NewDraftCommand.NotifyCanExecuteChanged();
    }

    partial void OnDraftNameChanged(string value)
    {
        OnPropertyChanged(nameof(IsDraftDirty));
        OnPropertyChanged(nameof(DraftStateLabel));
        SaveDraftCommand.NotifyCanExecuteChanged();
    }

    private void RebuildLayers()
    {
        var selectedPart = SelectedLayer?.Part;
        Layers.Clear();
        if (_session is not null)
            foreach (var layer in _session.Draft.Layers)
                Layers.Add(new HairLayerListItem(layer.Part, layer.AssetId, layer.IsVisible, layer.Transform));
        SelectedLayer = selectedPart is { } part ? Layers.FirstOrDefault(item => item.Part == part) : null;
        OnPropertyChanged(nameof(HasNoLayers));
        OnPropertyChanged(nameof(EmptyLayerMessage));
        OnPropertyChanged(nameof(HasSelectedLayer));
    }

    partial void OnSelectedLayerChanged(HairLayerListItem? value)
    {
        OnPropertyChanged(nameof(HasSelectedLayer));
        OnPropertyChanged(nameof(SelectedLayerLabel));
        if (value is null) return;
        LayerX = value.Transform.Translation.X.ToString("0.###", CultureInfo.CurrentCulture);
        LayerY = value.Transform.Translation.Y.ToString("0.###", CultureInfo.CurrentCulture);
        LayerScaleX = value.Transform.Scale.X.ToString("0.###", CultureInfo.CurrentCulture);
        LayerScaleY = value.Transform.Scale.Y.ToString("0.###", CultureInfo.CurrentCulture);
        LayerRotation = (value.Transform.RotationRadians * 180d / Math.PI).ToString("0.###", CultureInfo.CurrentCulture);
        LayerFlipX = value.Transform.FlipX;
    }

    private void ReconcileStagedLayers(HairSheetImportPreview previous, HairSheetImportPreview next)
    {
        if (_session is null) return;
        var sameSource = string.Equals(previous.OriginalSha256, next.OriginalSha256, StringComparison.Ordinal);
        var replacements = sameSource
            ? new Dictionary<AssetId, AssetId>
            {
                [previous.StagedPosteriorAssetId] = next.StagedPosteriorAssetId,
                [previous.StagedTraseiroAssetId] = next.StagedTraseiroAssetId
            }
            : new Dictionary<AssetId, AssetId>();
        var invalid = sameSource
            ? new HashSet<AssetId>()
            : new HashSet<AssetId> { previous.StagedPosteriorAssetId, previous.StagedTraseiroAssetId };
        _session.ReconcileAssetReferences(replacements, invalid);
        RebuildLayers();
        OnLayerSessionChanged();
        if (!sameSource) Status = "A fonte mudou; camadas que apontavam para o staging anterior foram removidas do rascunho.";
    }

    private void RemoveStagedLayers(HairSheetImportPreview preview)
    {
        if (_session is null) return;
        _session.ReconcileAssetReferences(new Dictionary<AssetId, AssetId>(),
            new HashSet<AssetId> { preview.StagedPosteriorAssetId, preview.StagedTraseiroAssetId });
        RebuildLayers();
        OnLayerSessionChanged();
    }

    private void OnLayerSessionChanged()
    {
        OnPropertyChanged(nameof(IsDraftDirty));
        OnPropertyChanged(nameof(DraftStateLabel));
        SaveDraftCommand.NotifyCanExecuteChanged();
        PublishDraftCommand.NotifyCanExecuteChanged();
        NewDraftCommand.NotifyCanExecuteChanged();
        OnPropertyChanged(nameof(CanUndoLayer));
        OnPropertyChanged(nameof(CanRedoLayer));
        OnPropertyChanged(nameof(CanAddPosteriorLayer));
        OnPropertyChanged(nameof(CanAddTraseiroLayer));
        UndoLayerCommand.NotifyCanExecuteChanged();
        RedoLayerCommand.NotifyCanExecuteChanged();
        AddPosteriorLayerCommand.NotifyCanExecuteChanged();
        AddTraseiroLayerCommand.NotifyCanExecuteChanged();
    }

    private static uint PackRgb(SKColor color) => (uint)(color.Red << 16 | color.Green << 8 | color.Blue);

    private static bool TryParseNumber(string value, out double number) =>
        double.TryParse(value, NumberStyles.Float, CultureInfo.CurrentCulture, out number) && double.IsFinite(number);

    private async Task PrepareAsync(Stream source, string mediaType, CancellationToken cancellationToken)
    {
        var result = await _importService!.PrepareAsync(source, mediaType,
            new HairSheetOptions(Tolerance, SelectedMode.Mode), cancellationToken);
        await AcceptResultAsync(result, cancellationToken);
    }

    private async Task AcceptResultAsync(Result<HairSheetImportPreview> result, CancellationToken cancellationToken)
    {
        if (result.IsFailure)
        {
            Error = result.Error!.Message;
            return;
        }

        if (cancellationToken.IsCancellationRequested || Volatile.Read(ref _disposed) != 0)
        {
            await result.Value.DisposeAsync();
            cancellationToken.ThrowIfCancellationRequested();
            return;
        }

        var previous = Preview;
        if (previous is not null) ReconcileStagedLayers(previous, result.Value);
        Preview = result.Value;
        await ClearTintAsync();
        if (previous is not null) await previous.DisposeAsync();
        Error = null;
        Status = "Folha preparada em segundo plano; a origem continua preservada.";
        await RefreshTintAsync(cancellationToken);
    }

    private async Task RefreshTintAsync(CancellationToken cancellationToken = default)
    {
        if (Preview is not { } current || _tintProcessor is null)
        {
            await ClearTintAsync();
            return;
        }
        var colors = _overrides.ToDictionary(pair => pair.Key, pair => pair.Value);
        if (colors.Count == 0)
        {
            await ClearTintAsync();
            return;
        }

        var posterior = await _tintProcessor.ProcessAsync(current.PosteriorPreview, colors,
            cancellationToken: cancellationToken);
        try
        {
            var traseiro = await _tintProcessor.ProcessAsync(current.TraseiroPreview, colors,
                cancellationToken: cancellationToken);
            var previousPosterior = PosteriorTint;
            var previousTraseiro = TraseiroTint;
            PosteriorTint = posterior;
            TraseiroTint = traseiro;
            posterior = null!;
            OnPropertyChanged(nameof(PosteriorTint));
            OnPropertyChanged(nameof(TraseiroTint));
            previousPosterior?.Dispose();
            previousTraseiro?.Dispose();
            Status = "Paleta aplicada somente à prévia; os PNGs originais continuam intactos.";
        }
        finally
        {
            posterior?.Dispose();
        }
    }

    private async Task ClearTintAsync()
    {
        PosteriorTint?.Dispose();
        TraseiroTint?.Dispose();
        PosteriorTint = null;
        TraseiroTint = null;
        OnPropertyChanged(nameof(PosteriorTint));
        OnPropertyChanged(nameof(TraseiroTint));
        await Task.CompletedTask;
    }

    private async Task ClearPreviewAsync()
    {
        var preview = Preview;
        Preview = null;
        await ClearTintAsync();
        if (preview is not null) await preview.DisposeAsync();
    }

    private CancellationTokenSource BeginOperation()
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        var operation = new CancellationTokenSource();
        _activeOperation = operation;
        _activeOperationCompletion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        IsBusy = true;
        return operation;
    }

    private void EndOperation(CancellationTokenSource operation)
    {
        if (ReferenceEquals(_activeOperation, operation))
        {
            _activeOperation = null;
            _activeOperationCompletion?.TrySetResult();
            _activeOperationCompletion = null;
        }
        IsBusy = false;
    }

    partial void OnToleranceChanged(int value)
    {
        if (Preview is not null) Status = "Tolerância alterada; reprocesse para atualizar a folha.";
    }

    private static bool TryParseHex(string value, out SKColor color)
    {
        var normalized = value.Trim();
        if (normalized.StartsWith('#')) normalized = normalized[1..];
        if (normalized.Length == 6 && uint.TryParse(normalized, NumberStyles.HexNumber,
                CultureInfo.InvariantCulture, out var rgb))
        {
            color = new SKColor((byte)(rgb >> 16), (byte)(rgb >> 8), (byte)rgb);
            return true;
        }
        color = SKColors.Transparent;
        return false;
    }

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        var operation = _activeOperation;
        var completion = _activeOperationCompletion?.Task;
        operation?.Cancel();
        if (completion is not null) await completion.ConfigureAwait(false);
        await ClearPreviewAsync();
    }
}

public sealed record HairPartOption(HairPartId Part, string Label)
{
    public static HairPartOption BackHair { get; } = new(HairPartId.BackHair, "Cabelo traseiro");
    public static HairPartOption Ponytail { get; } = new(HairPartId.Ponytail, "Rabo de cavalo");
    public override string ToString() => Label;
}

public sealed record HairLayerListItem(HairPartId Part, AssetId AssetId, bool IsVisible, Transform2D Transform)
{
    public string VisibilityButtonLabel => IsVisible ? "Ocultar" : "Mostrar";
    public string Label => Part switch
    {
        HairPartId.BackHair => "Cabelo traseiro",
        HairPartId.RearHair => "Cabelo posterior",
        HairPartId.Ponytail => "Rabo de cavalo",
        HairPartId.FrontHair => "Franja frontal",
        HairPartId.Ahoge => "Ahoge",
        _ => "Parte de cabelo"
    };
    public string AssetLabel => $"Asset temporário · {AssetId.Value.ToString("N")[..8]}";
}

public sealed record HairDraftListItem(HairId Id, string Name, Revision Revision)
{
    public string Label => $"{Name} · revisão {Revision.Value}";
}

public sealed record HairBackgroundModeOption(HairBackgroundMode Mode, string Label)
{
    public static HairBackgroundModeOption Auto { get; } = new(HairBackgroundMode.Auto, "Detectar automaticamente");
    public static HairBackgroundModeOption Green { get; } = new(HairBackgroundMode.Green, "Verde / chroma verde");
    public static HairBackgroundModeOption Checker { get; } = new(HairBackgroundMode.Checker, "Quadriculado cinza");
    public override string ToString() => Label;
}

public partial class HairRoleColorItem : ObservableObject
{
    public HairRoleColorItem(HairColorRole role, string label, string defaultHex)
    {
        Role = role;
        Label = label;
        HexColor = defaultHex;
    }

    public HairColorRole Role { get; }
    public string Label { get; }

    [ObservableProperty]
    private string hexColor = string.Empty;

    [ObservableProperty]
    private bool isOverridden;
}
