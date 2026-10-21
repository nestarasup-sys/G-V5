namespace GV5.Application.Contracts;

/// <summary>Static route metadata that lets the desktop shell expose a module page.</summary>
public sealed record ModuleRoute
{
    public string Id { get; }
    public string Title { get; }
    public string Description { get; }
    public Type ViewModelType { get; }

    public ModuleRoute(string id, string title, string description, Type viewModelType)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(id);
        ArgumentException.ThrowIfNullOrWhiteSpace(title);
        ArgumentException.ThrowIfNullOrWhiteSpace(description);
        ArgumentNullException.ThrowIfNull(viewModelType);

        if (!typeof(IModulePageViewModel).IsAssignableFrom(viewModelType) || viewModelType.IsAbstract)
        {
            throw new ArgumentException(
                $"The page type must be a concrete {nameof(IModulePageViewModel)}.",
                nameof(viewModelType));
        }

        Id = id;
        Title = title;
        Description = description;
        ViewModelType = viewModelType;
    }
}

/// <summary>Marker contract implemented by a module's page ViewModel.</summary>
public interface IModulePageViewModel
{
}
