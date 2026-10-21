using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Platform.Storage;
using GV5.Application.Contracts;

namespace GV5.App.Services;

/// <summary>Windows/Avalonia adapter for the shared image file-picker contract.</summary>
internal sealed class AvaloniaFilePicker : IFilePicker
{
    private static readonly FilePickerFileType SupportedImages = new("Imagens para modelo")
    {
        Patterns = ["*.png", "*.jpg", "*.jpeg", "*.webp"],
        MimeTypes = ["image/png", "image/jpeg", "image/webp"]
    };

    public async Task<PickedFile?> PickImageAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (Avalonia.Application.Current?.ApplicationLifetime is not IClassicDesktopStyleApplicationLifetime desktop
            || desktop.MainWindow is not { } window)
        {
            throw new InvalidOperationException("The desktop file picker is unavailable without the main window.");
        }

        var selection = await window.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            AllowMultiple = false,
            Title = "Selecionar folha do modelo",
            FileTypeFilter = [SupportedImages]
        });
        cancellationToken.ThrowIfCancellationRequested();
        var file = selection.FirstOrDefault();
        if (file is null)
        {
            return null;
        }

        var mediaType = Path.GetExtension(file.Name).ToLowerInvariant() switch
        {
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".webp" => "image/webp",
            _ => throw new InvalidDataException("Selecione uma imagem PNG, JPEG ou WebP.")
        };

        var content = await file.OpenReadAsync();
        return new PickedFile(file.Name, mediaType, content);
    }
}
