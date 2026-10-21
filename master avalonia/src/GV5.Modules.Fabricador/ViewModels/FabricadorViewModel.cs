using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using GV5.Application.Contracts;
using GV5.Core.Models;

namespace GV5.Modules.Fabricador.ViewModels;

public partial class FabricadorViewModel : ObservableObject, IModulePageViewModel
{
    private readonly IModelDraftRepository _repository;
    private readonly IDataPlatformInitializer _dataInitializer;
    private ModelDraft? _savedDraft;

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
        SaveState = PersistenceState.Dirty;
    }

    [RelayCommand(CanExecute = nameof(CanSave))]
    private async Task SaveAsync()
    {
        if (!CanSave)
        {
            return;
        }

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
        }
    }
}
