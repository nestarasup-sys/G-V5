using GV5.Application.Contracts;

namespace GV5.Modules.Fabricador.ViewModels;

public sealed class FabricadorViewModel : IModulePageViewModel
{
    public string Status { get; } = "A área do Fabricador está registrada no shell. A criação e publicação de modelos será conectada às camadas de dados e geometria nas próximas fases.";
}
