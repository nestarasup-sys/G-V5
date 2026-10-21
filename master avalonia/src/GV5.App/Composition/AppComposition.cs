using GV5.App.ViewModels;
using GV5.App.Views;
using GV5.App.Navigation;
using GV5.Application.Contracts;
using GV5.Assets.Decoding;
using GV5.Data.Migrations;
using GV5.Data.Diagnostics;
using GV5.Data.Assets;
using GV5.Data.Repositories;
using GV5.Data.Storage;
using GV5.Modules.Customizador;
using GV5.Modules.Fabricador;
using Microsoft.Extensions.DependencyInjection;

namespace GV5.App.Composition;

/// <summary>Registers desktop services in one place at application startup.</summary>
internal static class AppComposition
{
    public static ServiceProvider CreateProvider()
    {
        var services = new ServiceCollection();
        var routes = new[] { FabricadorModule.Route, CustomizadorModule.Route };

        services.AddSingleton<IAppDataPaths>(_ => AppDataPaths.ForCurrentUser());
        services.AddSingleton<IOperationCorrelationContext, OperationCorrelationContext>();
        services.AddSingleton<IStructuredDiagnosticLogger, StructuredFileLogger>();
        services.AddSingleton<IGv5Database, SqliteDatabase>();
        services.AddSingleton<ISqliteMigration, InitialAssetSchemaMigration>();
        services.AddSingleton<ISqliteMigration, ModelDraftSchemaMigration>();
        services.AddSingleton<ISqliteMigration, ModelDraftCheckpointSchemaMigration>();
        services.AddSingleton<ISqliteMigration, AssetImportJournalSchemaMigration>();
        services.AddSingleton<ISqliteMigration, AssetReferenceSchemaMigration>();
        services.AddSingleton<SqliteMigrationRunner>();
        services.AddSingleton<IDataPlatformInitializer>(provider => provider.GetRequiredService<SqliteMigrationRunner>());
        services.AddSingleton<IModelDraftRepository, SqliteModelDraftRepository>();
        services.AddSingleton<IModelDraftCheckpointStore, SqliteModelDraftCheckpointStore>();
        services.AddSingleton<IDataPlatformBackupService, DatabaseBackupService>();
        services.AddSingleton<AssetImageDecoder>();
        services.AddSingleton<SqliteAssetImportPipeline>();
        services.AddSingleton<IAssetStore, SqliteAssetStore>();
        services.AddSingleton(new ModuleRouteCatalog(routes));
        services.AddTransient<IModulePageFactory, ServiceProviderModulePageFactory>();
        foreach (var route in routes)
        {
            services.AddTransient(route.ViewModelType);
        }

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
