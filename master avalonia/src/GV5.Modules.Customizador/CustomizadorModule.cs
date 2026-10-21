using GV5.Application.Contracts;
using GV5.Modules.Customizador.ViewModels;

namespace GV5.Modules.Customizador;

/// <summary>Static shell entry for the Customizador area.</summary>
public static class CustomizadorModule
{
    public static ModuleRoute Route { get; } = new(
        id: "customizador",
        title: "Customizador",
        description: "Personagens montados a partir de modelos publicados, com ajustes privados.",
        viewModelType: typeof(CustomizadorViewModel));
}
