using System.Text.RegularExpressions;
using System.Xml.Linq;
using Xunit;

namespace GV5.Architecture.Tests;

public sealed class ProjectBoundaryTests
{
    private static readonly Regex SolutionProjectPattern = new(
        "^Project\\(\"[^\"]+\"\\) = \"[^\"]+\", \"(?<path>[^\"]+\\.csproj)\"",
        RegexOptions.Multiline | RegexOptions.CultureInvariant);

    [Fact]
    public void Core_DoesNotReferenceAvaloniaOrUiModules()
    {
        var root = FindSolutionRoot();
        var core = LoadProject(Path.Combine(root, "src", "GV5.Core", "GV5.Core.csproj"));

        var uiPackages = core.Descendants()
            .Where(element => element.Name.LocalName == "PackageReference")
            .Select(element => (string?)element.Attribute("Include"))
            .Where(include => include is not null)
            .Where(include => include!.StartsWith("Avalonia", StringComparison.OrdinalIgnoreCase)
                              || string.Equals(include, "CommunityToolkit.Mvvm", StringComparison.OrdinalIgnoreCase));

        var uiProjects = ReadProjectReferences(core)
            .Where(IsUiProjectReference);

        Assert.Empty(uiPackages);
        Assert.Empty(uiProjects);
    }

    [Fact]
    public void ProductModules_DoNotReferenceAppOrEachOther()
    {
        var root = FindSolutionRoot();
        var moduleFiles = new[]
        {
            Path.Combine(root, "src", "GV5.Modules.Fabricador", "GV5.Modules.Fabricador.csproj"),
            Path.Combine(root, "src", "GV5.Modules.Customizador", "GV5.Modules.Customizador.csproj")
        };

        foreach (var moduleFile in moduleFiles)
        {
            var project = LoadProject(moduleFile);
            var forbidden = ReadProjectReferences(project)
                .Where(IsUiProjectReference);

            Assert.Empty(forbidden);
        }
    }

    [Fact]
    public void AppViews_PresentStateWithoutOwningSceneCompositionOrSkiaRendering()
    {
        var root = FindSolutionRoot();
        var viewsRoot = Path.Combine(root, "src", "GV5.App", "Views");
        var forbiddenTokens = new[]
        {
            "GV5.Rendering",
            "BodyRenderSceneBuilder",
            "SkiaRenderer",
            "SKCanvas",
            "SKSurface",
            "RenderScene"
        };
        var viewFiles = Directory.EnumerateFiles(viewsRoot, "*.*", SearchOption.AllDirectories)
            .Where(path => Path.GetExtension(path) is ".cs" or ".axaml");

        foreach (var viewFile in viewFiles)
        {
            var content = File.ReadAllText(viewFile);
            foreach (var forbiddenToken in forbiddenTokens)
            {
                Assert.DoesNotContain(forbiddenToken, content, StringComparison.Ordinal);
            }
        }
    }

    [Fact]
    public void Rendering_StaysOnCpuUntilGpuInteropHasAnExplicitOwnerAndLifecycle()
    {
        var root = FindSolutionRoot();
        var renderingRoot = Path.Combine(root, "src", "GV5.Rendering");
        var sourceFiles = Directory.EnumerateFiles(renderingRoot, "*.cs", SearchOption.AllDirectories);

        foreach (var sourceFile in sourceFiles)
        {
            var content = File.ReadAllText(sourceFile);
            Assert.DoesNotContain("GRContext", content, StringComparison.Ordinal);
            Assert.DoesNotContain("GRGlInterface", content, StringComparison.Ordinal);
        }

        var skiaRenderer = File.ReadAllText(Path.Combine(renderingRoot, "SkiaRenderer.cs"));
        Assert.Contains("SKSurface.Create(info)", skiaRenderer, StringComparison.Ordinal);
    }

    [Fact]
    public void Solution_ContainsOnlyExistingProjectsInsideNewAppRoots()
    {
        var root = FindSolutionRoot();
        var solution = File.ReadAllText(Path.Combine(root, "GV5.sln"));
        var projectPaths = SolutionProjectPattern.Matches(solution)
            .Select(match => match.Groups["path"].Value)
            .ToArray();

        Assert.NotEmpty(projectPaths);

        foreach (var relativePath in projectPaths)
        {
            Assert.True(IsInsideNewAppRoots(relativePath), $"Solution project escapes the new app: {relativePath}");
            var projectPath = Path.GetFullPath(relativePath.Replace('\\', Path.DirectorySeparatorChar), root);
            Assert.True(File.Exists(projectPath), $"Solution project does not exist: {relativePath}");
        }
    }

    [Fact]
    public void ProjectRootGuard_RejectsLegacyAndParentTraversalPaths()
    {
        Assert.False(IsInsideNewAppRoots("../Electron/src/OldApp.csproj"));
        Assert.False(IsInsideNewAppRoots("src/../../legacy/Legacy.csproj"));
        Assert.False(IsInsideNewAppRoots("C:/legacy/Legacy.csproj"));
    }

    private static bool IsInsideNewAppRoots(string relativePath)
    {
        var normalized = relativePath.Replace('\\', '/');
        if (Path.IsPathRooted(relativePath) || normalized.StartsWith("/", StringComparison.Ordinal))
        {
            return false;
        }

        var parts = normalized.Split('/', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length > 1
               && parts[0] is "src" or "tests"
               && parts.All(part => part is not "." and not "..");
    }

    private static string FindSolutionRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "GV5.sln")))
            {
                return directory.FullName;
            }
        }

        throw new DirectoryNotFoundException("Could not locate GV5.sln above the architecture test output.");
    }

    private static XDocument LoadProject(string path) => XDocument.Load(path);

    private static IEnumerable<string> ReadProjectReferences(XDocument project) => project.Descendants()
        .Where(element => element.Name.LocalName == "ProjectReference")
        .Select(element => (string?)element.Attribute("Include"))
        .Where(include => include is not null)
        .Select(include => include!);

    private static bool IsUiProjectReference(string include)
    {
        var projectName = Path.GetFileNameWithoutExtension(include);
        return string.Equals(projectName, "GV5.App", StringComparison.OrdinalIgnoreCase)
               || projectName.StartsWith("GV5.Modules.", StringComparison.OrdinalIgnoreCase);
    }
}
