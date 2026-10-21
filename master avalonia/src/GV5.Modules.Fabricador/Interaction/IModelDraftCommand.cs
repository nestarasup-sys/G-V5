using GV5.Core.Models;

namespace GV5.Modules.Fabricador.Interaction;

/// <summary>A reversible, in-memory edit to a Fabricator model draft.</summary>
public interface IModelDraftCommand
{
    ModelDraftContent Apply(ModelDraftContent content);
    ModelDraftContent Revert(ModelDraftContent content);
}
