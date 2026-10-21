using Avalonia.Controls;
using GV5.App.ViewModels;

namespace GV5.App.Views;

public partial class MainWindow : Window
{
    private bool _allowClose;
    private bool _isFlushingClose;

    public MainWindow()
    {
        InitializeComponent();
        Closing += OnClosing;
    }

    private async void OnClosing(object? sender, WindowClosingEventArgs e)
    {
        if (_allowClose)
        {
            return;
        }

        if (DataContext is not MainViewModel viewModel)
        {
            return;
        }

        e.Cancel = true;
        if (_isFlushingClose)
        {
            return;
        }

        _isFlushingClose = true;
        try
        {
            if (await viewModel.FlushCurrentPageAsync())
            {
                _allowClose = true;
                Close();
                return;
            }

            viewModel.NavigationError = "Não foi possível salvar as alterações pendentes. A janela permanece aberta; corrija o erro e tente novamente.";
        }
        catch (Exception)
        {
            viewModel.NavigationError = "O salvamento pendente falhou. A janela permanece aberta para você não perder as alterações.";
        }
        finally
        {
            _isFlushingClose = false;
        }
    }
}
