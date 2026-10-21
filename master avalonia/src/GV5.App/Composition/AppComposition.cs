using GV5.App.ViewModels;
using GV5.App.Views;
using Microsoft.Extensions.DependencyInjection;

namespace GV5.App.Composition;

/// <summary>Registers desktop services in one place at application startup.</summary>
internal static class AppComposition
{
    public static ServiceProvider CreateProvider()
    {
        var services = new ServiceCollection();

        services.AddTransient<MainViewModel>();
        services.AddTransient<MainWindow>(provider => new MainWindow
        {
            DataContext = provider.GetRequiredService<MainViewModel>()
        });

        return services.BuildServiceProvider(new ServiceProviderOptions
        {
            ValidateOnBuild = true,
            ValidateScopes = true
        });
    }
}
