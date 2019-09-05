describe('searchPanes - options - searchPanes.emptyMessage', function() {
	let table;

	dt.libs({
		js: ['jquery', 'datatables', 'select', 'searchpanes'],
		css: ['datatables', 'select', 'searchpanes']
	});

	describe('Functional tests', function() {
		dt.html('basic');
		it('Check default', function() {
			$('#example tbody tr:eq(2) td:eq(2)').text('');
			table = $('#example').DataTable({
				dom: 'Sfrtip'
			});

			expect($('div.dtsp-searchPane:eq(2) table tbody tr:eq(3) td:eq(0)').html()).toBe('<i>No Data</i>');
		});
		it('Refers to expected row', function() {
			$('div.dtsp-searchPane:eq(2) table tbody tr:eq(3) td:eq(0)').click();
			expect($('#example tbody tr:eq(0) td:eq(0)').text()).toBe('Ashton Cox');
		});

		dt.html('basic');
		it('Change the default', function() {
			$('#example tbody tr:eq(2) td:eq(2)').text('');
			table = $('#example').DataTable({
				searchPanes: {
					emptyMessage: '<i><b>EMPTY</b></i>'
				},
				dom: 'Sfrtip'
			});

			expect($('div.dtsp-searchPane:eq(2) table tbody tr:eq(1) td:eq(0)').html()).toBe('<i><b>EMPTY</b></i>');
		});
		it('Refers to expected row', function() {
			$('div.dtsp-searchPane:eq(2) table tbody tr:eq(1) td:eq(0)').click();
			expect($('#example tbody tr:eq(0) td:eq(0)').text()).toBe('Ashton Cox');
		});
	});
});