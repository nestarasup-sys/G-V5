using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using GV5.Application.Contracts;
using GV5.Assets.Processing;
using GV5.Core.Models;
using GV5.Modules.Fabricador.Import;
using SkiaSharp;

namespace GV5.Modules.Fabricador.ViewModels;

/// <summary>Owns import, chroma and role-tint preview state for the hair workspace.</summary>
public partial class HairWorkspaceViewModel : ObservableObject, IAsyncDisposable
{
    private readonly IFilePicker? _filePicker;
    private readonly HairSheetImportService? _importService;
    private readonly HairRoleTintProcessor? _tintProcessor;
    private readonly Dictionary<HairColorRole, SKColor> _overrides = [];
    private CancellationTokenSource? _activeOperation;
    private TaskCompletionSource? _activeOperationCompletion;
    private int _disposed;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasPreview))]
    [NotifyPropertyChangedFor(nameof(PreviewDimensions))]
    [NotifyPropertyChangedFor(nameof(CanReprocess))]
    [NotifyPropertyChangedFor(nameof(CanCancel))]
    [NotifyCanExecuteChangedFor(nameof(ReprocessCommand))]
    [NotifyCanExecuteChangedFor(nameof(CancelCommand))]
    [NotifyCanExecuteChangedFor(nameof(ApplyRoleColorCommand))]
    [NotifyCanExecuteChangedFor(nameof(ResetRoleColorCommand))]
    [NotifyCanExecuteChangedFor(nameof(ResetPaletteCommand))]
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

    private HairBackgroundModeOption _selectedMode = HairBackgroundModeOption.Auto;

    public HairWorkspaceViewModel(IFilePicker? filePicker, HairSheetImportService? importService,
        HairRoleTintProcessor? tintProcessor)
    {
        _filePicker = filePicker;
        _importService = importService;
        _tintProcessor = tintProcessor;
        RoleColors =
        [
            new(HairColorRole.Base, "Base", "#9B563E"),
            new(HairColorRole.Fade, "Degradê", "#633B37"),
            new(HairColorRole.Outline, "Contorno", "#392B33"),
            new(HairColorRole.Highlight, "Luzes", "#E5AD83"),
            new(HairColorRole.Accent, "Destaque", "#CF6391")
        ];
    }

    public ObservableCollection<HairRoleColorItem> RoleColors { get; }
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
        try { await RefreshTintAsync(operation.Token); }
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
        try { await RefreshTintAsync(operation.Token); }
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
        try { await RefreshTintAsync(operation.Token); }
        catch (OperationCanceledException) { Status = "Restauração da paleta cancelada."; }
        catch (Exception exception) when (exception is InvalidOperationException or ArgumentException or IOException)
        { Error = "Não foi possível restaurar a paleta na prévia."; }
        finally { EndOperation(operation); }
    }

    private bool CanChangePalette() => !IsBusy && Preview is not null && _tintProcessor is not null;

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
