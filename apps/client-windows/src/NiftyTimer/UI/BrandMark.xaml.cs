using System.Windows.Controls;

namespace NiftyTimer.UI;

/// <summary>
/// The product mark. All geometry lives in the XAML, where BrandMarkTests can read it; this file
/// exists only because a WPF UserControl needs its generated partner.
///
/// Note that NiftyTimer.csproj removes the System.Windows.Shapes implicit using so System.IO.Path
/// wins the name collision. That affects C# only — the XAML above resolves its Path elements
/// through the presentation xmlns and is unaffected.
/// </summary>
public partial class BrandMark : UserControl
{
    public BrandMark() => InitializeComponent();
}
