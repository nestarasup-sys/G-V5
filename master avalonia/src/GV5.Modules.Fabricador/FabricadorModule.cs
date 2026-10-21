using GV5.Application.Contracts;
using GV5.Modules.Fabricador.ViewModels;

namespace GV5.Modules.Fabricador;

/// <summary>Static shell entry for the Fabricador area.</summary>
public static class FabricadorModule
{
    public static ModuleRoute Route { get; } = new(
        id: "fabricador",
        title: "Fabricador",
        description: "Base de modelos, peças e assets que serão publicados para os outros módulos.",
        viewModelType: typeof(FabricadorViewModel));
}
