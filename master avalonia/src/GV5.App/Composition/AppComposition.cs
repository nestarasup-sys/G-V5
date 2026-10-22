using GV5.App.ViewModels;
using GV5.App.Views;
using GV5.App.Navigation;
using GV5.App.Presentation;
using GV5.App.Services;
using GV5.Application.Contracts;
using GV5.Application.Services;
using GV5.Assets.Decoding;
using GV5.Assets.Import;
using GV5.Assets.Processing;
using GV5.Data.Migrations;
using GV5.Data.Diagnostics;
using GV5.Data.Dependencies;
using GV5.Data.Assets;
using GV5.Data.Repositories;
using GV5.Data.Storage;
using GV5.Data.Thumbnails;
using GV5.Modules.Customizador;
using GV5.Modules.Fabricador;
using GV5.Modules.Fabricador.Import;
using GV5.Rendering;
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
        services.AddSingleton<IFilePicker, AvaloniaFilePicker>();
        services.AddSingleton<IStructuredDiagnosticLogger, StructuredFileLogger>();
        services.AddSingleton<SqliteDatabase>();
        services.AddSingleton<IGv5Database>(provider => provider.GetRequiredService<SqliteDatabase>());
        services.AddSingleton<ISqliteMigration, InitialAssetSchemaMigration>();
        services.AddSingleton<ISqliteMigration, ModelDraftSchemaMigration>();
        services.AddSingleton<ISqliteMigration, ModelDraftCheckpointSchemaMigration>();
        services.AddSingleton<ISqliteMigration, AssetImportJournalSchemaMigration>();
        services.AddSingleton<ISqliteMigration, AssetReferenceSchemaMigration>();
        services.AddSingleton<ISqliteMigration, AssetGarbageCollectionSchemaMigration>();
        services.AddSingleton<ISqliteMigration, ModelDraftContentSchemaMigration>();
        services.AddSingleton<ISqliteMigration, ModelRevisionSchemaMigration>();
        services.AddSingleton<ISqliteMigration, ModelRigJointSchemaMigration>();
        services.AddSingleton<ISqliteMigration, PoseRepositorySchemaMigration>();
        services.AddSingleton<ISqliteMigration, AnimationRepositorySchemaMigration>();
        services.AddSingleton<ISqliteMigration, WardrobeRepositorySchemaMigration>();
        services.AddSingleton<ISqliteMigration, HairStyleRepositorySchemaMigration>();
        services.AddSingleton<ISqliteMigration, FaceCatalogRepositorySchemaMigration>();
        services.AddSingleton<ISqliteMigration, FaceExpressionRepositorySchemaMigration>();
        services.AddSingleton<ISqliteMigration, FacePublicationSchemaMigration>();
        services.AddSingleton<ISqliteMigration, AnimationSlotsSchemaMigration>();
        services.AddSingleton<ISqliteMigration, ModelSlotSchemaMigration>();
        services.AddSingleton<SqliteMigrationRunner>();
        services.AddSingleton<IDataPlatformInitializer>(provider => provider.GetRequiredService<SqliteMigrationRunner>());
        services.AddSingleton<IAssetCatalog, SqliteAssetCatalog>();
        services.AddSingleton<IAssetGarbageCollector, SqliteAssetGarbageCollector>();
        services.AddSingleton<IModelDraftRepository, SqliteModelDraftRepository>();
        services.AddSingleton<IModelSlotRepository, SqliteModelSlotRepository>();
        services.AddSingleton<IModelDraftContentRepository, SqliteModelDraftContentRepository>();
        services.AddSingleton<IModelRevisionRepository, SqliteModelRevisionRepository>();
        services.AddSingleton<IPoseRepository, SqlitePoseRepository>();
        services.AddSingleton<IAnimationRepository, SqliteAnimationRepository>();
        services.AddSingleton<IWardrobeRepository, SqliteWardrobeRepository>();
        services.AddSingleton<IHairStyleRepository, SqliteHairStyleRepository>();
        services.AddSingleton<IFaceCatalogRepository, SqliteFaceCatalogRepository>();
        services.AddSingleton<IFaceExpressionRepository, SqliteFaceExpressionRepository>();
        services.AddSingleton<IFabricatorDependencyCatalog, SqliteFabricatorDependencyCatalog>();
        services.AddSingleton<IWardrobeCatalog>(provider => new WardrobeCatalog(
            provider.GetRequiredService<IWardrobeRepository>(), provider.GetRequiredService<IThumbnailService>()));
        services.AddSingleton<PublishModelRevisionService>();
        services.AddSingleton<DuplicatePoseService>();
        services.AddSingleton<IModelDraftCheckpointStore, SqliteModelDraftCheckpointStore>();
        services.AddSingleton<IDataPlatformBackupService, DatabaseBackupService>();
        services.AddSingleton<AssetImageDecoder>();
        services.AddSingleton<ChromaCropProcessor>();
        services.AddSingleton<FaceSheetProcessor>();
        services.AddSingleton<HairSheetProcessor>();
        services.AddSingleton<HairRoleTintProcessor>();
        services.AddSingleton<ModelSheetSegmentationProcessor>();
        services.AddSingleton(provider => new AssetImportStager(
            Path.Combine(provider.GetRequiredService<IAppDataPaths>().TempDirectory, "fabricator-source-imports"),
            new AssetImportLimits(
                MaximumBytes: 50L * 1024 * 1024,
                MaximumDimension: 16_384,
                MaximumPixels: 32_000_000)));
        services.AddSingleton<ModelSourceImportService>();
        services.AddSingleton<FaceSheetImportService>();
        services.AddSingleton<ModelPartSplitService>();
        services.AddSingleton<ModelPartMergeService>();
        services.AddSingleton<ModelPartMixerService>();
        services.AddSingleton<HairSheetImportService>();
        services.AddSingleton<AssetBitmapCache>();
        services.AddSingleton<AvaloniaRenderedFrameAdapter>();
        services.AddSingleton<IRenderAssetProvider, AssetStoreRenderProvider>();
        services.AddSingleton<IRenderSceneRenderer, SkiaRenderer>();
        services.AddSingleton<IThumbnailService, ThumbnailService>();
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
