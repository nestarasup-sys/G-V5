using GV5.Geometry;

namespace GV5.Modules.Fabricador.Interaction;

public readonly record struct TransformGestureStart(ModelPartTransformKind Kind, Point2D ScenePoint);
