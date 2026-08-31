namespace NiftyTimer.App;

/// <summary>
/// One selectable row in the project picker.
///
/// Project and task names are separate fields rather than one pre-joined label because the row is
/// two-line — project on top, task beneath in the secondary colour — and because the search matches
/// them independently. A project row carries a null <c>TaskName</c>.
/// </summary>
public sealed record PickerItem(string ProjectName, string? TaskName, string ProjectId, string? TaskId);
