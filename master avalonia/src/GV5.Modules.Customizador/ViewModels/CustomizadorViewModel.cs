using GV5.Application.Contracts;

namespace GV5.Modules.Customizador.ViewModels;

public sealed class CustomizadorViewModel : IModulePageViewModel
{
    public string Status { get; } = "A área do Customizador está registrada no shell. Ela consumirá modelos publicados e manterá as escolhas de cada personagem separadas dos assets globais.";
}
