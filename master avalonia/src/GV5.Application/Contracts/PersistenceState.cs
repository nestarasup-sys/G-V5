namespace GV5.Application.Contracts;

/// <summary>Confirmed persistence state displayed by editing surfaces.</summary>
public enum PersistenceState
{
    Saved = 1,
    Dirty = 2,
    Saving = 3,
    Error = 4
}
