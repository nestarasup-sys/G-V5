using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using GV5.Application.Contracts;
using GV5.Core.Models;

namespace GV5.Modules.Fabricador.ViewModels;

public partial class FabricadorViewModel : ObservableObject, IModulePageViewModel, IFlushablePageViewModel
{
    private static readonly TimeSpan AutosaveDelay = TimeSpan.FromMilliseconds(600);
    private readonly IModelDraftRepository _repository;
    private readonly IDataPlatformInitializer _dataInitializer;
    private ModelDraft? _savedDraft;
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
    private bool isSaving;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(SaveStateLabel))]
    private PersistenceState saveState = PersistenceState.Dirty;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasSaveError))]
    private string? saveError;

    public bool CanSave => !IsSaving && !string.IsNullOrWhiteSpace(ModelName);
    public bool CanEdit => !IsSaving;
    public bool HasSaveError => !string.IsNullOrWhiteSpace(SaveError);

    public string SaveStateLabel => SaveState switch
    {
        PersistenceState.Saved => "Salvo",
        PersistenceState.Dirty => "Alterações não salvas",
        PersistenceState.Saving => "Salvando…",
        PersistenceState.Error => "Erro ao salvar",
        _ => "Estado desconhecido"
    };

    public string Status { get; } = "Crie um rascunho de modelo. As alterações só aparecem como salvas após a confirmação do SQLite.";

    public FabricadorViewModel(IModelDraftRepository repository, IDataPlatformInitializer dataInitializer)
    {
        _repository = repository ?? throw new ArgumentNullException(nameof(repository));
        _dataInitializer = dataInitializer ?? throw new ArgumentNullException(nameof(dataInitializer));
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
        IsSaving = true;
        SaveState = PersistenceState.Saving;
        SaveError = null;
        try
        {
            await _dataInitializer.InitializeAsync();
            var now = Math.Max(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), _savedDraft?.UpdatedUtcMs ?? 0);
            var draft = _savedDraft is null
                ? ModelDraft.Create(ModelName, now)
                : _savedDraft.Rename(ModelName, now);

            var result = _savedDraft is null
                ? await _repository.CreateAsync(draft)
                : await _repository.UpdateAsync(draft, _savedDraft.Revision);

            if (result.IsFailure)
            {
                SaveError = result.Error!.Message;
                SaveState = PersistenceState.Error;
                return;
            }

            _savedDraft = result.Value;
            ModelName = _savedDraft.Name;
            SaveState = PersistenceState.Saved;
        }
        catch (Exception)
        {
            SaveError = "Não foi possível gravar o rascunho. Verifique o acesso à pasta de dados e tente novamente.";
            SaveState = PersistenceState.Error;
        }
        finally
        {
            IsSaving = false;
            _activeSaveTask = null;
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
}
