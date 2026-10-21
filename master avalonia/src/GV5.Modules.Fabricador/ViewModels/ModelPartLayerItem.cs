using GV5.Core.Identity;

namespace GV5.Modules.Fabricador.ViewModels;

public sealed record ModelPartLayerItem(
    ModelPartId Id,
    string Name,
    int StackPosition,
    string LayerStatus,
    bool IsVisible,
    bool IsSelected,
    string VisibilityLabel,
    bool CanEdit,
    bool CanMoveForward,
    bool CanMoveBackward);
